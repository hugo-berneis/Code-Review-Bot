import * as vscode from 'vscode';
import { exec } from 'child_process';
import { readFile, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { DiagnosisResult, ErrorPattern, ERROR_LIBRARY, extractLineNumber, diagnoseOutput } from './errorLibrary';
import { getAnimationStyles, getAnimationScripts } from './animations';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'qwen2.5-coder:7b';

const SYSTEM_PROMPT = `Expert code reviewer. Return ONLY raw JSON, no markdown:
{"summary":"1-3 sentences","issues":[{"type":"label","severity":"low|medium|high|critical","description":"problem","suggestion":"fix","code_fix":"snippet or null"}],"refactored_code":"improved code"}
Modes: CLARIFY=readability, EFFICIENCY=performance, DOCUMENTATION=missing docs, OVERSIGHT=security vulnerabilities and unsafe operations. Empty issues array if none.`;

type ReviewMode = 'CLARIFY' | 'EFFICIENCY' | 'DOCUMENTATION' | 'OVERSIGHT';

interface Issue {
	type: string;
	severity: 'low' | 'medium' | 'high' | 'critical';
	description: string;
	suggestion: string;
	code_fix: string | null;
}

interface ReviewResult {
	summary: string;
	issues: Issue[];
	refactored_code?: string;
}

//level of problem severity that need to be fixed
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function isReviewResult(val: unknown): val is ReviewResult {
	if (typeof val !== 'object' || val === null) return false;
	const v = val as Record<string, unknown>;
	if (typeof v.summary !== 'string') return false;
	if (v.refactored_code !== undefined && typeof v.refactored_code !== 'string') return false;
	if (!Array.isArray(v.issues)) return false;
	for (const issue of v.issues) {
		if (typeof issue !== 'object' || issue === null) return false;
		const i = issue as Record<string, unknown>;
		if (typeof i.type !== 'string') return false;
		if (!VALID_SEVERITIES.has(i.severity as string)) return false;
		if (typeof i.description !== 'string') return false;
		if (typeof i.suggestion !== 'string') return false;
		if (i.code_fix !== null && typeof i.code_fix !== 'string') return false;
	}
	return true;
}

// ── Debug Checker ────────────────────────────────────────────────────────────

// Keyed by filePath → { promise, mtime at compile start }.
// If the file mtime hasn't changed we reuse the existing promise (cache hit).
// If the file was saved since last compile we kick off a fresh compile.
interface _BinEntry { p: Promise<string | null>; mtime: number; }
const _binCache = new Map<string, _BinEntry>();
// Stores compiler stderr when compilation fails, so we can diagnose it.
const _compileStderr = new Map<string, string>();

function compileToCache(compiler: string, filePath: string): Promise<string | null> {
	let mtime = 0;
	try { mtime = statSync(filePath).mtimeMs; } catch { return Promise.resolve(null); }

	const entry = _binCache.get(filePath);
	if (entry && entry.mtime === mtime) return entry.p; // file unchanged — reuse

	const p = new Promise<string | null>(resolve => {
		readFile(filePath, (err, content) => {
			if (err) { resolve(null); return; }
			const hash = createHash('md5').update(content).digest('hex').slice(0, 12);
			const bin = `/tmp/dbg_${hash}`;
			if (existsSync(bin)) { _compileStderr.delete(filePath); resolve(bin); return; }
			exec(`${compiler} -o "${bin}"`, (_compErr, _stdout, stderr) => {
				if (_compErr) { _compileStderr.set(filePath, stderr); resolve(null); }
				else { _compileStderr.delete(filePath); resolve(bin); }
			});
		});
	});

	_binCache.set(filePath, { p, mtime });
	return p;
}

// Resolves to a ready-to-run { cmd, cwd }, compiling C/C++ if needed.
async function prepareRunCommand(language: string, filePath: string, workspaceRoot: string): Promise<{ cmd: string; cwd: string } | null> {
	const dir = path.dirname(filePath);
	const nameNoExt = path.basename(filePath).replace(/\.[^.]+$/, '');
	const fp = filePath.replace(/"/g, '\\"');

	switch (language) {
		case 'javascript': return { cmd: `node "${fp}"`,                                      cwd: dir };
		case 'typescript': return { cmd: `npx ts-node "${fp}"`,                               cwd: workspaceRoot };
		case 'python':     return { cmd: `python3 "${fp}"`,                                   cwd: dir };
		case 'go':         return { cmd: `go run "${fp}"`,                                    cwd: dir };
		case 'rust':       return { cmd: `cargo run`,                                         cwd: workspaceRoot };
		case 'java':       return { cmd: `javac "${fp}" && java -cp "${dir}" ${nameNoExt}`,   cwd: dir };
		case 'c': {
			const bin = await compileToCache(`gcc "${fp}"`, filePath);
			return bin ? { cmd: `"${bin}"`, cwd: dir } : null;
		}
		case 'cpp': {
			const bin = await compileToCache(`g++ "${fp}"`, filePath);
			return bin ? { cmd: `"${bin}"`, cwd: dir } : null;
		}
		default: return null;
	}
}

async function runDebugHelper(panel: vscode.WebviewPanel, language: string, filePath: string, workspaceRoot: string, ready: Promise<{ cmd: string; cwd: string } | null>): Promise<void> {
	// Tell the webview we're compiling if the promise hasn't resolved yet
	let resolved = false;
	ready.then(() => { resolved = true; });
	await Promise.resolve(); // flush microtask queue so the .then above can run
	if (!resolved) {
		panel.webview.postMessage({ type: 'debugStatus', message: 'Compiling…' });
	}
	const runCmd = await ready;

	if (!runCmd) {
		// Compilation failed — diagnose the compiler errors if we captured them
		const compileErr = _compileStderr.get(filePath);
		if (compileErr) {
			const results = diagnoseOutput(compileErr, language);
			panel.webview.postMessage({ type: 'debugResult', results });
		} else {
			panel.webview.postMessage({ type: 'debugResult', unsupported: true, language });
		}
		return;
	}

	exec(runCmd.cmd, { cwd: runCmd.cwd, timeout: 15000 }, (_err, _stdout, stderr) => {
		const errOutput = stderr.trim();
		if (!errOutput) {
			panel.webview.postMessage({ type: 'debugResult', clean: true });
			return;
		}
		const results = diagnoseOutput(errOutput, language);
		panel.webview.postMessage({ type: 'debugResult', results });
	});
}

// ── Extension ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('code-review-bot.openReviewPanel', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('Open a file to review.');
			return;
		}

		const document = editor.document;
		const selection = editor.selection;
		const code = selection.isEmpty ? document.getText() : document.getText(selection);
		const filePath = document.fileName;
		const fileName = filePath.split('/').pop() || filePath;
		const language = document.languageId;
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(filePath);

		createReviewPanel(code, fileName, filePath, language, workspaceRoot, context);
	});

	context.subscriptions.push(disposable);
}

function createReviewPanel(
	code: string, fileName: string, filePath: string,
	language: string, workspaceRoot: string,
	context: vscode.ExtensionContext
) {
	const panel = vscode.window.createWebviewPanel(
		'codeReview',
		`Review: ${fileName}`,
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = getWebviewContent(fileName, language);

	// Warn if Ollama is not reachable (AI review modes won't work without it).
	fetch('http://localhost:11434', { signal: AbortSignal.timeout(2000) })
		.catch(() => {
			vscode.window.showWarningMessage(
				'Ollama is not running. AI review modes (C, O, D, E) require it. ' +
				'Start it with: ollama serve'
			);
		});

	// Compile immediately when the panel opens.
	let readyCmd = prepareRunCommand(language, filePath, workspaceRoot);

	// Re-compile in the background every time the file is saved so the binary is
	// ready before the user clicks "Run & Diagnose".
	const fsWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath))
	);
	fsWatcher.onDidChange(() => {
		readyCmd = prepareRunCommand(language, filePath, workspaceRoot);
	});
	context.subscriptions.push(fsWatcher);

	const listener = panel.webview.onDidReceiveMessage(async msg => {
		if (msg.type === 'startReview') {
			const modes = (msg.modes as string[]).filter(
				m => m === 'CLARIFY' || m === 'EFFICIENCY' || m === 'DOCUMENTATION' || m === 'OVERSIGHT'
			) as ReviewMode[];
			if (modes.length === 0) {
				panel.webview.postMessage({ type: 'error', message: 'No valid modes selected.' });
				return;
			}
			// Auto-save and re-read so the review always uses the current in-editor version
			const doc = vscode.workspace.textDocuments.find(d => d.fileName === filePath);
			if (doc?.isDirty) { await doc.save(); }
			const currentCode = doc ? doc.getText() : code;
			runReviews(panel, currentCode, language, modes);
		}
		if (msg.type === 'runDebug') {
			// Auto-save so the debug checker always runs the current in-editor version
			const doc = vscode.workspace.textDocuments.find(d => d.fileName === filePath);
			if (doc?.isDirty) {
				await doc.save();
				readyCmd = prepareRunCommand(language, filePath, workspaceRoot);
			}
			runDebugHelper(panel, language, filePath, workspaceRoot, readyCmd);
		}
	});

	context.subscriptions.push(listener);
}

async function runReviews(
	panel: vscode.WebviewPanel,
	code: string,
	language: string,
	modes: ReviewMode[]
): Promise<void> {
	panel.webview.postMessage({ type: 'reviewing', modes });

	for (const mode of modes) {
		const userPayload = `MODE:${mode}\nLANG:${language}\n${code}`;
		try {
			const response = await fetch(OLLAMA_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: OLLAMA_MODEL, system: SYSTEM_PROMPT, prompt: userPayload, stream: false }),
			});
			if (!response.ok) throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
			const json = await response.json() as { response: string };
			const raw = json.response;
			// extract first {...} block to handle extra prose around JSON
			const jsonMatch = raw.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error(`No JSON found in response:\n${raw.slice(0, 300)}`);
			const parsed: unknown = JSON.parse(jsonMatch[0]);
			if (!isReviewResult(parsed)) {
				throw new Error(`Schema mismatch. Got:\n${JSON.stringify(parsed, null, 2).slice(0, 400)}`);
			}
			panel.webview.postMessage({ type: 'modeResult', mode, data: parsed });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			panel.webview.postMessage({ type: 'modeError', mode, message });
		}
	}

	panel.webview.postMessage({ type: 'allDone' });
}

function normalizeLangForCheatsheet(lang: string): string {
	if (lang === 'javascriptreact') { return 'javascript'; }
	if (lang === 'typescriptreact') { return 'typescript'; }
	if (lang === 'bash' || lang === 'zsh') { return 'shellscript'; }
	return lang;
}

const CHEATSHEET_TOPICS = [
	'Character Output', 'User Input', 'Program Structure', 'Conditionals',
	'Comments', 'Relational Operators', 'Compile & Execute', 'Random Number',
	'Variables & Data Types', 'Loops', 'Logical Operations',
	'Arithmetic Operators', 'Chaining',
];

const CHEATSHEET_DATA: Record<string, Record<string, string>> = {
	javascript: {
		'Character Output':
`console.log("Hello, World!");
console.log("Value:", 42);
process.stdout.write("No newline");`,
		'User Input':
`const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin, output: process.stdout
});
rl.question('Enter your name: ', name => {
  console.log('Hello, ' + name);
  rl.close();
});`,
		'Program Structure':
`// index.js
function main() {
  console.log("Hello!");
}
main();`,
		'Conditionals':
`if (score >= 90) {
  console.log("A");
} else if (score >= 80) {
  console.log("B");
} else {
  console.log("C or below");
}

const label = score >= 60 ? "Pass" : "Fail";  // ternary

switch (day) {
  case "Mon": console.log("Monday"); break;
  default:    console.log("Other");
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/**
 * JSDoc comment
 * @param {string} name
 */`,
		'Relational Operators':
`a === b  // strict equal
a !== b  // strict not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`node filename.js

# With npm script
npm start`,
		'Random Number':
`Math.random();                                 // float [0, 1)
Math.floor(Math.random() * n);                 // int [0, n-1]
Math.floor(Math.random() * (max-min+1)) + min; // int [min, max]`,
		'Variables & Data Types':
`let name    = "Alice";   // string
let age     = 25;         // number
let pi      = 3.14;       // number (float)
let active  = true;       // boolean
let nothing = null;       // null
let undef;                // undefined
const MAX   = 100;        // constant

let nums = [1, 2, 3];                  // Array
let user = { name: "Alice", age: 25 }; // Object`,
		'Loops':
`// for
for (let i = 0; i < 5; i++) { console.log(i); }

// while
let i = 0;
while (i < 5) { i++; }

// for...of  (arrays)
for (const item of [1, 2, 3]) { console.log(item); }

// for...in  (object keys)
for (const key in obj) { console.log(key, obj[key]); }`,
		'Logical Operations':
`a && b   // AND — true if both true
a || b   // OR  — true if either true
!a       // NOT — flips boolean

let val  = input || "default";  // short-circuit OR
let safe = obj && obj.name;     // short-circuit AND`,
		'Arithmetic Operators':
`a + b   // addition
a - b   // subtraction
a * b   // multiplication
a / b   // division
a % b   // modulo (remainder)
a ** b  // exponentiation
a++     // increment
a--     // decrement`,
		'Chaining':
`[1, 2, 3, 4, 5]
  .filter(n => n % 2 === 0)
  .map(n => n * 2)
  .forEach(n => console.log(n));

const city = user?.address?.city;         // optional chaining
const name = user?.name ?? "Anonymous";   // nullish coalescing`,
	},

	typescript: {
		'Character Output':
`console.log("Hello, World!");
console.log(\`Template: \${value}\`);`,
		'User Input':
`import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin, output: process.stdout
});
rl.question('Enter your name: ', (name: string) => {
  console.log(\`Hello, \${name}\`);
  rl.close();
});`,
		'Program Structure':
`// main.ts
function main(): void {
  console.log("Hello, TypeScript!");
}
main();`,
		'Conditionals':
`if (score >= 90) {
  console.log("A");
} else if (score >= 80) {
  console.log("B");
} else {
  console.log("C or below");
}

const label: string = score >= 60 ? "Pass" : "Fail";`,
		'Comments':
`// Single-line comment

/* Multi-line comment */

/**
 * TSDoc — shown in IntelliSense
 * @param name - the person's name
 * @returns greeting string
 */`,
		'Relational Operators':
`a === b  // strict equal
a !== b  // strict not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`# Compile then run
tsc filename.ts && node filename.js

# Or with ts-node (no compile step)
npx ts-node filename.ts`,
		'Random Number':
`const float: number = Math.random();
const int: number   = Math.floor(Math.random() * n);`,
		'Variables & Data Types':
`let name:   string  = "Alice";
let age:    number  = 25;
let active: boolean = true;
const MAX:  number  = 100;

let nums: number[]      = [1, 2, 3];
let strs: Array<string> = ["a", "b"];

interface User { name: string; age: number; }
type ID = string | number;`,
		'Loops':
`for (let i = 0; i < 5; i++) { console.log(i); }

for (const item of items) { console.log(item); }

let i = 0;
while (i < 5) { i++; }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT
a ?? b   // Nullish coalescing (use b if a is null/undefined)`,
		'Arithmetic Operators':
`a + b   // addition
a - b   // subtraction
a * b   // multiplication
a / b   // division
a % b   // modulo
a ** b  // exponentiation`,
		'Chaining':
`const result = items
  .filter((x): x is number => typeof x === 'number')
  .map(n => n * 2)
  .reduce((sum, n) => sum + n, 0);

const city = user?.address?.city ?? "Unknown";`,
	},

	python: {
		'Character Output':
`print("Hello, World!")
print(f"Value: {value}")
print("a", "b", sep=", ", end="\\n")`,
		'User Input':
`name = input("Enter your name: ")
print(f"Hello, {name}")

age = int(input("Enter your age: "))`,
		'Program Structure':
`def main():
    print("Hello!")

if __name__ == "__main__":
    main()`,
		'Conditionals':
`if score >= 90:
    print("A")
elif score >= 80:
    print("B")
else:
    print("C or below")

label = "Pass" if score >= 60 else "Fail"  # ternary`,
		'Comments':
`# Single-line comment

"""
Multi-line string / docstring
"""

def greet(name):
    """Greet a person by name."""
    pass`,
		'Relational Operators':
`a == b   # equal
a != b   # not equal
a >  b   # greater than
a <  b   # less than
a >= b   # greater than or equal
a <= b   # less than or equal
a is b   # identity (same object in memory)`,
		'Compile & Execute':
`python3 filename.py`,
		'Random Number':
`import random

random.random()          # float [0.0, 1.0)
random.randint(1, 10)    # int [1, 10]  (inclusive)
random.choice([1,2,3])   # random element from list`,
		'Variables & Data Types':
`name    = "Alice"    # str
age     = 25          # int
pi      = 3.14        # float
active  = True        # bool
nothing = None        # NoneType

nums  = [1, 2, 3]                     # list
user  = {"name": "Alice", "age": 25}  # dict
point = (10, 20)                       # tuple (immutable)
tags  = {"python", "code"}             # set`,
		'Loops':
`for i in range(5):       # 0..4
    print(i)

for item in [1, 2, 3]:
    print(item)

i = 0
while i < 5:
    i += 1

for i, val in enumerate(items):  # index + value
    print(i, val)`,
		'Logical Operations':
`a and b   # AND
a or b    # OR
not a     # NOT`,
		'Arithmetic Operators':
`a + b    # addition
a - b    # subtraction
a * b    # multiplication
a / b    # division (float result)
a // b   # floor division (int result)
a % b    # modulo
a ** b   # exponentiation`,
		'Chaining':
`result = "hello world".split().pop().upper()

evens_doubled = [x * 2 for x in range(10) if x % 2 == 0]

# Chained comparisons (unique to Python)
if 0 < x < 100:
    print("in range")`,
	},

	go: {
		'Character Output':
`package main
import "fmt"

fmt.Println("Hello, World!")
fmt.Printf("Name: %s, Age: %d\\n", name, age)
fmt.Print("No newline")`,
		'User Input':
`package main
import "fmt"

var name string
fmt.Print("Enter your name: ")
fmt.Scan(&name)
fmt.Println("Hello,", name)`,
		'Program Structure':
`package main

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}`,
		'Conditionals':
`if score >= 90 {
    fmt.Println("A")
} else if score >= 80 {
    fmt.Println("B")
} else {
    fmt.Println("C or below")
}

switch day {
case "Mon":
    fmt.Println("Monday")
default:
    fmt.Println("Other")
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

// Exported symbols use // for godoc:
// Package main provides the entry point.`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`go run filename.go

# Build then run
go build -o prog filename.go
./prog`,
		'Random Number':
`import "math/rand"

rand.Float64()            // float [0.0, 1.0)
rand.Intn(100)            // int [0, 100)
rand.Intn(max-min) + min  // int [min, max)`,
		'Variables & Data Types':
`var name string  = "Alice"
var age  int     = 25
var pi   float64 = 3.14
var ok   bool    = true

// Short declaration (inside functions)
x := 42

// Slice (dynamic array)
items := []string{"a", "b", "c"}

// Map
user := map[string]interface{}{"name": "Alice", "age": 25}`,
		'Loops':
`// Go has only "for"
for i := 0; i < 5; i++ { fmt.Println(i) }

// while-style
i := 0
for i < 5 { i++ }

// range (like for-each)
for i, v := range items { fmt.Println(i, v) }

// infinite
for { break }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b   // addition
a - b   // subtraction
a * b   // multiplication
a / b   // division
a % b   // modulo
a++     // increment (statement, not expression)
a--     // decrement`,
		'Chaining':
`import "strings"

result := strings.TrimSpace(strings.ToLower(input))

// Error chaining pattern
if err := doA(); err != nil { return err }
if err := doB(); err != nil { return err }`,
	},

	java: {
		'Character Output':
`System.out.println("Hello, World!");
System.out.print("No newline");
System.out.printf("Name: %s, Age: %d%n", name, age);`,
		'User Input':
`import java.util.Scanner;

Scanner sc = new Scanner(System.in);
System.out.print("Enter your name: ");
String name = sc.nextLine();
System.out.println("Hello, " + name);
sc.close();`,
		'Program Structure':
`public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
    }
}`,
		'Conditionals':
`if (score >= 90) {
    System.out.println("A");
} else if (score >= 80) {
    System.out.println("B");
} else {
    System.out.println("C or below");
}

String label = score >= 60 ? "Pass" : "Fail";  // ternary

switch (day) {
    case "Mon" -> System.out.println("Monday");  // Java 14+
    default    -> System.out.println("Other");
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/**
 * Javadoc comment
 * @param name the person's name
 * @return greeting string
 */`,
		'Relational Operators':
`a == b        // equal (primitives) / reference equal (objects)
a != b        // not equal
a >  b        // greater than
a <  b        // less than
a >= b        // greater than or equal
a <= b        // less than or equal
a.equals(b)   // value equality for Strings and objects`,
		'Compile & Execute':
`javac Main.java
java Main`,
		'Random Number':
`import java.util.Random;

Random rand = new Random();
rand.nextDouble();             // float [0.0, 1.0)
rand.nextInt(100);             // int [0, 100)
rand.nextInt(max - min) + min; // int [min, max)

Math.random();                 // float [0.0, 1.0) — no import`,
		'Variables & Data Types':
`String  name   = "Alice";
int     age    = 25;
double  pi     = 3.14;
boolean active = true;
char    grade  = 'A';

int[] nums = {1, 2, 3};

import java.util.ArrayList;
ArrayList<String> list = new ArrayList<>();
list.add("hello");

import java.util.HashMap;
HashMap<String, Integer> map = new HashMap<>();
map.put("age", 25);`,
		'Loops':
`for (int i = 0; i < 5; i++) { System.out.println(i); }

int i = 0;
while (i < 5) { i++; }

for (String item : items) { System.out.println(item); }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b         // addition
a - b         // subtraction
a * b         // multiplication
a / b         // division
a % b         // modulo
a++           // increment
a--           // decrement
Math.pow(a,b) // exponentiation`,
		'Chaining':
`// StringBuilder
String result = new StringBuilder()
    .append("Hello").append(", ").append("World!")
    .toString();

// Stream API (Java 8+)
List<Integer> evens = list.stream()
    .filter(n -> n % 2 == 0)
    .map(n -> n * 2)
    .collect(Collectors.toList());`,
	},

	c: {
		'Character Output':
`#include <stdio.h>

printf("Hello, World!\\n");
printf("Name: %s, Age: %d\\n", name, age);
putchar('A');`,
		'User Input':
`#include <stdio.h>

char name[100];
printf("Enter your name: ");
scanf("%99s", name);
printf("Hello, %s\\n", name);

// Read full line (safer)
fgets(name, sizeof(name), stdin);`,
		'Program Structure':
`#include <stdio.h>

int main() {
    printf("Hello, C!\\n");
    return 0;
}`,
		'Conditionals':
`if (score >= 90) {
    printf("A\\n");
} else if (score >= 80) {
    printf("B\\n");
} else {
    printf("C or below\\n");
}

const char* label = score >= 60 ? "Pass" : "Fail";

switch (day) {
    case 1:  printf("Monday\\n"); break;
    default: printf("Other\\n");
}`,
		'Comments':
`// Single-line (C99+)

/* Multi-line
   comment */`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`gcc filename.c -o prog
./prog

# With warnings (recommended)
gcc -Wall -Wextra filename.c -o prog`,
		'Random Number':
`#include <stdlib.h>
#include <time.h>

srand(time(NULL));                        // seed once at startup
int r  = rand();                          // random int
int n  = rand() % 100;                    // [0, 99]
int n2 = rand() % (max - min + 1) + min; // [min, max]`,
		'Variables & Data Types':
`char   grade   = 'A';
int    age     = 25;
float  pi      = 3.14f;
double precise = 3.14159;
long   big     = 1000000L;

int  nums[3]  = {1, 2, 3};   // fixed array
char name[50] = "Alice";      // string (char array)
int *ptr      = &age;         // pointer`,
		'Loops':
`for (int i = 0; i < 5; i++) { printf("%d\\n", i); }

int i = 0;
while (i < 5) { i++; }

do {
    printf("%d\\n", i++);
} while (i < 5);`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b   // addition
a - b   // subtraction
a * b   // multiplication
a / b   // division (integer if both operands are int)
a % b   // modulo
a++     // increment
a--     // decrement`,
		'Chaining':
`// Function nesting (manual chaining)
result = transform(filter(parse(input)));

// Pointer member chaining
node->next->next->value;`,
	},

	cpp: {
		'Character Output':
`#include <iostream>
using namespace std;

cout << "Hello, World!" << endl;
cout << "Name: " << name << ", Age: " << age << "\\n";`,
		'User Input':
`#include <iostream>
#include <string>
using namespace std;

string name;
cout << "Enter your name: ";
cin >> name;
cout << "Hello, " << name << endl;

getline(cin, name);  // read full line (including spaces)`,
		'Program Structure':
`#include <iostream>
using namespace std;

int main() {
    cout << "Hello, C++!" << endl;
    return 0;
}`,
		'Conditionals':
`if (score >= 90) {
    cout << "A" << endl;
} else if (score >= 80) {
    cout << "B" << endl;
} else {
    cout << "C or below" << endl;
}

string label = score >= 60 ? "Pass" : "Fail";

switch (day) {
    case 1:  cout << "Monday" << endl; break;
    default: cout << "Other"  << endl;
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/// Doxygen doc comment
/// @param name the person's name`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`g++ filename.cpp -o prog
./prog

# C++17
g++ -std=c++17 -Wall filename.cpp -o prog`,
		'Random Number':
`#include <random>

mt19937 rng(random_device{}());
uniform_int_distribution<int> dist(1, 100);
int r = dist(rng);   // int [1, 100]

// Legacy (simpler but lower quality)
#include <cstdlib>
srand(time(0));
int n = rand() % 100;`,
		'Variables & Data Types':
`string  name   = "Alice";
int     age    = 25;
double  pi     = 3.14;
bool    active = true;
char    grade  = 'A';
auto    x      = 42;   // type deduced by compiler

vector<int> nums = {1, 2, 3};
map<string, int> scores;
scores["Alice"] = 95;`,
		'Loops':
`for (int i = 0; i < 5; i++) { cout << i << endl; }

int i = 0;
while (i < 5) { i++; }

// Range-based for (C++11)
for (const auto& item : items) { cout << item << endl; }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b      // addition
a - b      // subtraction
a * b      // multiplication
a / b      // division
a % b      // modulo
a++        // increment
a--        // decrement
pow(a, b)  // exponentiation (include <cmath>)`,
		'Chaining':
`// Stream chaining
cout << "a" << " " << "b" << endl;

// C++20 ranges
#include <ranges>
auto result = views::iota(1, 10)
    | views::filter([](int n){ return n % 2 == 0; })
    | views::transform([](int n){ return n * n; });`,
	},

	rust: {
		'Character Output':
`println!("Hello, World!");
println!("Name: {}, Age: {}", name, age);
print!("No newline");
eprintln!("To stderr: {}", err);`,
		'User Input':
`use std::io;

let mut input = String::new();
print!("Enter your name: ");
io::stdin().read_line(&mut input).unwrap();
let name = input.trim();
println!("Hello, {}", name);`,
		'Program Structure':
`fn main() {
    println!("Hello, Rust!");
}`,
		'Conditionals':
`if score >= 90 {
    println!("A");
} else if score >= 80 {
    println!("B");
} else {
    println!("C or below");
}

let label = if score >= 60 { "Pass" } else { "Fail" };

match day {
    "Mon" => println!("Monday"),
    _     => println!("Other"),
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/// Doc comment for item below (shown in rustdoc)
//! Doc comment for the parent module`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`# With Cargo (recommended)
cargo run

# Single file
rustc filename.rs
./filename`,
		'Random Number':
`// Add to Cargo.toml: rand = "0.8"
use rand::Rng;

let mut rng = rand::thread_rng();
let f: f64 = rng.gen();               // [0.0, 1.0)
let n: i32 = rng.gen_range(1..=100);  // [1, 100]`,
		'Variables & Data Types':
`let name: &str  = "Alice";           // string slice
let name = String::from("Alice");    // owned String
let age:  i32   = 25;
let pi:   f64   = 3.14;
let ok:   bool  = true;

let mut count = 0;   // mutable variable
count += 1;

let arr: [i32; 3] = [1, 2, 3];  // fixed array
let v: Vec<i32>   = vec![1, 2, 3]; // dynamic vector`,
		'Loops':
`loop { break; }            // infinite, exit with break

while i < 5 { i += 1; }

for i in 0..5  { println!("{}", i); }   // exclusive
for i in 0..=4 { println!("{}", i); }   // inclusive

for item in items.iter() { println!("{}", item); }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b       // addition
a - b       // subtraction
a * b       // multiplication
a / b       // division
a % b       // modulo
a.pow(b)    // integer exponentiation
a.powi(b)   // float ^ integer exponent
a.powf(b)   // float ^ float exponent`,
		'Chaining':
`let sum: i32 = (1..=10)
    .filter(|n| n % 2 == 0)
    .map(|n| n * n)
    .sum();

// Option chaining
let city = user.address.as_ref().map(|a| &a.city);

// ? operator (error propagation)
fn read() -> Result<String, Error> {
    let s = fs::read_to_string("f.txt")?;
    Ok(s.trim().to_string())
}`,
	},

	ruby: {
		'Character Output':
`puts "Hello, World!"      # with newline
print "No newline"
p 42                        # inspect output (debug)
printf "%s is %d\\n", name, age`,
		'User Input':
`print "Enter your name: "
name = gets.chomp           # chomp removes trailing newline
puts "Hello, #{name}"

age = gets.chomp.to_i       # convert string to integer`,
		'Program Structure':
`def main
  puts "Hello, Ruby!"
end

main`,
		'Conditionals':
`if score >= 90
  puts "A"
elsif score >= 80
  puts "B"
else
  puts "C or below"
end

label = score >= 60 ? "Pass" : "Fail"
puts "Pass" if score >= 60    # one-liner

case day
when "Mon" then puts "Monday"
else            puts "Other"
end`,
		'Comments':
`# Single-line comment

=begin
Multi-line comment
=end`,
		'Relational Operators':
`a == b   # equal
a != b   # not equal
a >  b   # greater than
a <  b   # less than
a >= b   # greater than or equal
a <= b   # less than or equal
a <=> b  # spaceship operator: -1, 0, or 1`,
		'Compile & Execute':
`ruby filename.rb`,
		'Random Number':
`rand          # float [0.0, 1.0)
rand(100)     # int [0, 99]
rand(1..10)   # int [1, 10]
[1,2,3].sample  # random element from array`,
		'Variables & Data Types':
`name    = "Alice"   # String
age     = 25         # Integer
pi      = 3.14       # Float
active  = true       # TrueClass
nothing = nil        # NilClass

nums = [1, 2, 3]
user = { name: "Alice", age: 25 }  # Hash (symbol keys)
:hello                               # Symbol`,
		'Loops':
`5.times { |i| puts i }

1.upto(5) { |i| puts i }

[1, 2, 3].each { |item| puts item }

i = 0
while i < 5 do i += 1 end

for i in 0..4 do puts i end`,
		'Logical Operations':
`a && b   # AND
a || b   # OR
!a       # NOT`,
		'Arithmetic Operators':
`a + b    # addition
a - b    # subtraction
a * b    # multiplication
a / b    # division
a % b    # modulo
a ** b   # exponentiation`,
		'Chaining':
`"hello world"
  .split
  .map(&:capitalize)
  .join(" ")

[1, 2, 3, 4, 5]
  .select(&:even?)
  .map { |n| n * 2 }
  .sum`,
	},

	php: {
		'Character Output':
`<?php
echo "Hello, World!\\n";
echo "Name: $name\\n";
print("Hello");
var_dump($value);    // debug with type info`,
		'User Input':
`<?php
echo "Enter your name: ";
$name = trim(fgets(STDIN));
echo "Hello, $name\\n";`,
		'Program Structure':
`<?php

function main(): void {
    echo "Hello, PHP!\\n";
}

main();`,
		'Conditionals':
`if ($score >= 90) {
    echo "A\\n";
} elseif ($score >= 80) {
    echo "B\\n";
} else {
    echo "C or below\\n";
}

$label = $score >= 60 ? "Pass" : "Fail";
$val   = $input ?? "default";   // null coalescing

$result = match($day) {
    "Mon" => "Monday",
    default => "Other",
};`,
		'Comments':
`// Single-line comment
# Also single-line

/* Multi-line
   comment */

/**
 * PHPDoc
 * @param string $name
 * @return string
 */`,
		'Relational Operators':
`$a == $b    // equal (loose — "1" == 1 is true)
$a === $b   // equal (strict — same type and value)
$a != $b    // not equal
$a !== $b   // not equal (strict)
$a >  $b    // greater than
$a <  $b    // less than
$a >= $b    // greater than or equal
$a <= $b    // less than or equal`,
		'Compile & Execute':
`php filename.php`,
		'Random Number':
`rand(1, 100);          // int [1, 100]
mt_rand(1, 100);        // Mersenne Twister (faster)
random_int(1, 100);     // cryptographically secure`,
		'Variables & Data Types':
`$name    = "Alice";    // string
$age     = 25;          // int
$pi      = 3.14;        // float
$active  = true;        // bool
$nothing = null;        // null

$nums = [1, 2, 3];
$user = ["name" => "Alice", "age" => 25];  // associative array`,
		'Loops':
`for ($i = 0; $i < 5; $i++) { echo $i . "\\n"; }

$i = 0;
while ($i < 5) { $i++; }

foreach ($items as $item) { echo $item . "\\n"; }
foreach ($map as $key => $val) { echo "$key: $val\\n"; }`,
		'Logical Operations':
`$a && $b   // AND
$a || $b   // OR
!$a        // NOT`,
		'Arithmetic Operators':
`$a + $b    // addition
$a - $b    // subtraction
$a * $b    // multiplication
$a / $b    // division
$a % $b    // modulo
$a ** $b   // exponentiation`,
		'Chaining':
`// Method chaining (fluent interface)
$result = $query
    ->select("*")
    ->from("users")
    ->where("active = 1")
    ->get();

$result = strtoupper(trim($input));`,
	},

	csharp: {
		'Character Output':
`Console.WriteLine("Hello, World!");
Console.Write("No newline");
Console.WriteLine($"Name: {name}, Age: {age}");`,
		'User Input':
`Console.Write("Enter your name: ");
string name = Console.ReadLine() ?? "";
Console.WriteLine($"Hello, {name}");

int age = int.Parse(Console.ReadLine() ?? "0");`,
		'Program Structure':
`// Top-level statements (C# 9+)
Console.WriteLine("Hello, C#!");

// Classic style
using System;
class Program {
    static void Main(string[] args) {
        Console.WriteLine("Hello, C#!");
    }
}`,
		'Conditionals':
`if (score >= 90) {
    Console.WriteLine("A");
} else if (score >= 80) {
    Console.WriteLine("B");
} else {
    Console.WriteLine("C or below");
}

string label = score >= 60 ? "Pass" : "Fail";

string result = day switch {
    "Mon" => "Monday",
    _     => "Other"
};`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/// <summary>
/// XML doc comment — shown in IntelliSense
/// </summary>
/// <param name="name">The person's name.</param>`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`dotnet run

# Build only
dotnet build`,
		'Random Number':
`var rng = new Random();
rng.NextDouble();              // float [0.0, 1.0)
rng.Next(100);                 // int [0, 100)
rng.Next(min, max + 1);        // int [min, max]`,
		'Variables & Data Types':
`string  name   = "Alice";
int     age    = 25;
double  pi     = 3.14;
bool    active = true;
char    grade  = 'A';
var     x      = 42;      // type inferred

int[] nums = {1, 2, 3};
var list = new List<string> { "a", "b" };
var dict = new Dictionary<string, int> { ["Alice"] = 95 };`,
		'Loops':
`for (int i = 0; i < 5; i++) { Console.WriteLine(i); }

int i = 0;
while (i < 5) { i++; }

foreach (var item in items) { Console.WriteLine(item); }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT
a ?? b   // Null coalescing`,
		'Arithmetic Operators':
`a + b         // addition
a - b         // subtraction
a * b         // multiplication
a / b         // division
a % b         // modulo
a++           // increment
a--           // decrement
Math.Pow(a,b) // exponentiation`,
		'Chaining':
`// LINQ chaining
var result = numbers
    .Where(n => n % 2 == 0)
    .Select(n => n * 2)
    .OrderBy(n => n)
    .ToList();

string s = "  hello world  "
    .Trim().ToUpper().Replace(" ", "_");

string? city = user?.Address?.City;`,
	},

	kotlin: {
		'Character Output':
`println("Hello, World!")
print("No newline")
println("Name: $name, Age: $age")`,
		'User Input':
`print("Enter your name: ")
val name = readLine() ?: ""
println("Hello, $name")

val age = readLine()?.toIntOrNull() ?: 0`,
		'Program Structure':
`fun main() {
    println("Hello, Kotlin!")
}`,
		'Conditionals':
`if (score >= 90) {
    println("A")
} else if (score >= 80) {
    println("B")
} else {
    println("C or below")
}

val label = if (score >= 60) "Pass" else "Fail"

when (day) {
    "Mon" -> println("Monday")
    else  -> println("Other")
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/**
 * KDoc comment
 * @param name the person's name
 */`,
		'Relational Operators':
`a == b    // structural equal (calls .equals())
a != b    // not equal
a >  b    // greater than
a <  b    // less than
a >= b    // greater than or equal
a <= b    // less than or equal
a === b   // referential equal (same object in memory)`,
		'Compile & Execute':
`kotlinc filename.kt -include-runtime -d out.jar
java -jar out.jar

# With Gradle
./gradlew run`,
		'Random Number':
`import kotlin.random.Random

Random.nextDouble()          // float [0.0, 1.0)
Random.nextInt(100)          // int [0, 100)
Random.nextInt(1, 101)       // int [1, 100]`,
		'Variables & Data Types':
`val name: String  = "Alice"    // immutable (val)
var age:  Int     = 25         // mutable (var)
val pi:   Double  = 3.14
val ok:   Boolean = true

var city: String? = null       // nullable type

val nums    = listOf(1, 2, 3)
val mutable = mutableListOf(1, 2, 3)
val user    = mapOf("name" to "Alice", "age" to 25)`,
		'Loops':
`for (i in 0 until 5) { println(i) }    // 0..4
for (i in 1..5)      { println(i) }    // 1..5

for (item in items) { println(item) }

var i = 0
while (i < 5) { i++ }

repeat(5) { i -> println(i) }`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b    // addition
a - b    // subtraction
a * b    // multiplication
a / b    // division
a % b    // modulo
a.pow(b) // exponentiation (Double)`,
		'Chaining':
`val result = listOf(1, 2, 3, 4, 5)
    .filter { it % 2 == 0 }
    .map { it * it }
    .sum()

val user = User().apply {
    name = "Alice"
    age  = 25
}

val upper = name?.trim()?.uppercase()`,
	},

	swift: {
		'Character Output':
`print("Hello, World!")
print("Name: \\(name), Age: \\(age)")
print("No newline", terminator: "")`,
		'User Input':
`print("Enter your name: ", terminator: "")
if let name = readLine() {
    print("Hello, \\(name)")
}`,
		'Program Structure':
`import Foundation

func main() {
    print("Hello, Swift!")
}

main()`,
		'Conditionals':
`if score >= 90 {
    print("A")
} else if score >= 80 {
    print("B")
} else {
    print("C or below")
}

let label = score >= 60 ? "Pass" : "Fail"

switch day {
case "Mon": print("Monday")
default:    print("Other")
}`,
		'Comments':
`// Single-line comment

/* Multi-line
   comment */

/// Quick Help doc comment
/// - Parameter name: The person's name
/// - Returns: A greeting string`,
		'Relational Operators':
`a == b   // equal
a != b   // not equal
a >  b   // greater than
a <  b   // less than
a >= b   // greater than or equal
a <= b   // less than or equal`,
		'Compile & Execute':
`swift filename.swift

# With Swift Package Manager
swift run`,
		'Random Number':
`Double.random(in: 0..<1)    // float [0, 1)
Int.random(in: 1...100)     // int [1, 100]
[1,2,3].randomElement()     // random element (returns Optional)`,
		'Variables & Data Types':
`let name: String    = "Alice"   // constant (let)
var age:  Int       = 25        // variable (var)
let pi:   Double    = 3.14
let ok:   Bool      = true
let c:    Character = "A"

var city: String? = nil          // optional

var nums: [Int]          = [1, 2, 3]
var user: [String: Any]  = ["name": "Alice", "age": 25]`,
		'Loops':
`for i in 0..<5 { print(i) }    // 0..4 (exclusive)
for i in 1...5 { print(i) }    // 1..5 (inclusive)

for item in items { print(item) }

var i = 0
while i < 5 { i += 1 }

repeat { i += 1 } while i < 5  // do-while equivalent`,
		'Logical Operations':
`a && b   // AND
a || b   // OR
!a       // NOT`,
		'Arithmetic Operators':
`a + b    // addition
a - b    // subtraction
a * b    // multiplication
a / b    // division
a % b    // modulo (integers)
// pow(a, b) — import Darwin for Float/Double`,
		'Chaining':
`let result = "  hello world  "
    .trimmingCharacters(in: .whitespaces)
    .uppercased()
    .replacingOccurrences(of: " ", with: "_")

let city = user?.address?.city   // optional chaining

let doubled = [1,2,3,4,5]
    .filter { $0 % 2 == 0 }
    .map { $0 * 2 }`,
	},

	shellscript: {
		'Character Output':
`echo "Hello, World!"
printf "Name: %s\\n" "$name"
printf "No newline"`,
		'User Input':
`read -p "Enter your name: " name
echo "Hello, $name"

read -s -p "Password: " pass    # silent (no echo)`,
		'Program Structure':
`#!/usr/bin/env bash
set -euo pipefail

main() {
    echo "Hello, Bash!"
}

main "$@"`,
		'Conditionals':
`if [ "$score" -ge 90 ]; then
    echo "A"
elif [ "$score" -ge 80 ]; then
    echo "B"
else
    echo "C or below"
fi

case "$day" in
    Mon) echo "Monday" ;;
    *)   echo "Other"  ;;
esac`,
		'Comments':
`# Single-line comment

: '
Multi-line comment
(colon with single-quoted string)
'`,
		'Relational Operators':
`# Numeric
[ "$a" -eq "$b" ]   # equal
[ "$a" -ne "$b" ]   # not equal
[ "$a" -gt "$b" ]   # greater than
[ "$a" -lt "$b" ]   # less than
[ "$a" -ge "$b" ]   # greater or equal
[ "$a" -le "$b" ]   # less or equal

# String
[ "$a" = "$b" ]     # equal
[ "$a" != "$b" ]    # not equal`,
		'Compile & Execute':
`chmod +x script.sh
./script.sh

# Run without making executable
bash script.sh`,
		'Random Number':
`echo $RANDOM                                   # int [0, 32767]
echo $((RANDOM % n))                           # [0, n-1]
echo $((RANDOM % (max - min + 1) + min))       # [min, max]`,
		'Variables & Data Types':
`name="Alice"          # string (no spaces around =)
age=25                 # integer (stored as string internally)
readonly MAX=100       # constant

nums=(1 2 3)           # indexed array
echo "\${nums[0]}"     # first element
echo "\${nums[@]}"     # all elements

declare -A user        # associative array (bash 4+)
user[name]="Alice"`,
		'Loops':
`for i in {0..4}; do echo $i; done

for item in "\${nums[@]}"; do echo "$item"; done

for ((i=0; i<5; i++)); do echo $i; done    # C-style

i=0
while [ $i -lt 5 ]; do ((i++)); done`,
		'Logical Operations':
`[ "$a" ] && [ "$b" ]   # AND
[ "$a" ] || [ "$b" ]   # OR
! [ "$a" ]              # NOT

[[ $a && $b ]]         # inside [[ ]] (preferred)
[[ $a || $b ]]`,
		'Arithmetic Operators':
`echo $((a + b))   # addition
echo $((a - b))   # subtraction
echo $((a * b))   # multiplication
echo $((a / b))   # integer division
echo $((a % b))   # modulo
echo $((a ** b))  # exponentiation`,
		'Chaining':
`# Pipe chaining
cat file.txt | grep "error" | sort | uniq -c

# Command chaining
mkdir -p dir && cd dir && touch file.txt

# OR fallback
command1 || command2`,
	},
};

function getWebviewContent(fileName: string, language: string): string {
	const cheatsheetLang = normalizeLangForCheatsheet(language);
	const cheatsheetB64 = Buffer.from(JSON.stringify(CHEATSHEET_DATA)).toString('base64');
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ================================================================
       ALL COLORS — edit anything here, nowhere else needed
       ================================================================

       MODE ACCENTS  (letter color, underline bar, run button, spinner)
       ---------------------------------------------------------------- */
    :root {
      --color-c: #7A1CAC;        /* C — Clarify letter & accent          */
      --color-o: #7A1CAC;        /* O — Oversight letter & accent         */
      --color-d: #7A1CAC;        /* D — Documentation letter & accent     */
      --color-e: #7A1CAC;        /* E — Efficiency letter & accent        */

      /* SEVERITY BADGE BACKGROUNDS */
      --sev-low-bg:      rgb(149, 246, 132); /* low      badge background            */
      --sev-med-bg:      #e9c46a; /* medium   badge background            */
      --sev-high-bg:     #e07b39; /* high     badge background            */
      --sev-crit-bg:     #f48771; /* critical badge background            */

      /* SEVERITY BADGE TEXT */
      --sev-low-fg:      #000;    /* low      badge text                  */
      --sev-med-fg:      #000;    /* medium   badge text                  */
      --sev-high-fg:     #fff;    /* high     badge text                  */
      --sev-crit-fg:     #fff;    /* critical badge text                  */

      /* BACKGROUNDS */
      --bg-body:         var(--vscode-editor-background);
      --bg-panel:        var(--vscode-sideBar-background, var(--vscode-editor-background));
      --bg-card:         var(--vscode-editor-inactiveSelectionBackground, transparent);
      --bg-code:         var(--vscode-textCodeBlock-background);
      --bg-hover:        var(--vscode-list-hoverBackground);
      --bg-error:        var(--vscode-inputValidation-errorBackground);
      --bg-warn:         var(--vscode-inputValidation-warningBackground);

      /* TEXT */
      --fg-body:         var(--vscode-editor-foreground);
      --fg-muted:        var(--vscode-descriptionForeground);
      --fg-btn:          var(--vscode-button-foreground);
      --fg-badge:        var(--vscode-badge-foreground);

      /* BORDERS */
      --border:          var(--vscode-panel-border);
      --border-focus:    var(--vscode-focusBorder);
      --border-error:    var(--vscode-inputValidation-errorBorder);
      --border-warn:     var(--vscode-inputValidation-warningBorder);

      /* MISC */
      --bg-badge:        var(--vscode-badge-background);
      --bg-run-btn:      var(--vscode-button-background);
      --ripple-color:    rgba(255,255,255,0.12);

      /* DEBUG HELPER */
      --color-debug:     #851818;  /* debug section accent & header color  */

      /* CHEATSHEET */
      --color-cheatsheet: #1A8C6C;
    }
    /* ============================================================== */

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg-body);
      background: var(--bg-body);
      padding: 20px;
      line-height: 1.6;
      max-width: 800px;
    }

    /* ── Header ── */
    #header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }

    #header h2 {
      font-size: 13px;
      font-weight: 600;
      opacity: 0.85;
    }

    .badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--bg-badge);
      color: var(--fg-badge);
      font-weight: 500;
      letter-spacing: 0.03em;
    }

    /* ── Toast ── */
    #toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: var(--bg-warn);
      border: 1px solid var(--border-warn);
      border-radius: 4px;
      padding: 7px 10px 7px 12px;
      font-size: 12px;
      margin-bottom: 16px;
    }

    #toast button {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--fg-body);
      font-size: 13px;
      padding: 0 2px;
      opacity: 0.65;
      flex-shrink: 0;
    }

    #toast button:hover { opacity: 1; }

    /* ── C O D E bar ── */
    #code-bar {
      display: flex;
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-panel);
      transition: border-radius 0.15s ease;
    }

    #code-bar.panel-open {
      border-radius: 8px 8px 0 0;
      border-bottom-color: transparent;
    }

    .code-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 22px 8px 18px;
      background: transparent;
      border: none;
      border-right: 1px solid var(--border);
      cursor: pointer;
      color: var(--fg-body);
      opacity: 0.45;
      transition: opacity 0.15s ease, background 0.15s ease;
      position: relative;
      overflow: hidden;
    }

    .code-btn:last-child { border-right: none; }

    .code-btn:hover {
      opacity: 0.8;
      background: var(--bg-hover);
    }

    .code-btn:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
    }

    .code-btn.active { opacity: 1; }

    .code-btn[data-mode="CLARIFY"]       { --accent: var(--color-c); }
    .code-btn[data-mode="OVERSIGHT"]     { --accent: var(--color-o); }
    .code-btn[data-mode="DOCUMENTATION"] { --accent: var(--color-d); }
    .code-btn[data-mode="EFFICIENCY"]    { --accent: var(--color-e); }

    .code-btn.active .letter { color: var(--accent); }

    .code-btn::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 3px;
      background: var(--accent);
      transform: scaleX(0);
      transition: transform 0.2s ease;
      transform-origin: center;
    }

    .code-btn.active::after { transform: scaleX(1); }

    .letter {
      font-size: 38px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -1px;
      transition: color 0.15s ease, transform 0.15s ease;
    }

    .code-btn:hover .letter { transform: translateY(-2px); }
    .code-btn.active .letter { transform: translateY(-1px); }

    .btn-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      opacity: 0.65;
    }

    /* ── Mode panel ── */
    #mode-panel {
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      background: var(--bg-panel);
      margin-bottom: 4px;
      overflow: hidden;
    }

    #panel-info {
      padding: 20px 20px 18px;
      border-bottom: 1px solid var(--border);
    }

    #panel-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;
    }

    #panel-bullets {
      list-style: none;
      margin-bottom: 16px;
    }

    #panel-bullets li {
      font-size: 12px;
      color: var(--fg-muted);
      padding-left: 14px;
      position: relative;
      margin-bottom: 3px;
    }

    #panel-bullets li::before {
      content: '•';
      position: absolute;
      left: 0;
      opacity: 0.5;
    }

    #run-btn {
      background: var(--active-accent, var(--bg-run-btn));
      color: var(--fg-btn);
      border: none;
      border-radius: 5px;
      padding: 7px 18px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      letter-spacing: 0.02em;
      transition: opacity 0.15s ease, transform 0.15s ease;
    }

    #run-btn:hover:not(:disabled) { opacity: 0.85; transform: translateY(-1px); }
    #run-btn:disabled { opacity: 0.38; cursor: not-allowed; }

    /* ── Output section ── */
    #output-section {
      padding: 16px 20px;
      min-height: 56px;
    }

    .output-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--fg-muted);
    }

    .spinner {
      width: 14px; height: 14px;
      border: 2px solid transparent;
      border-top-color: var(--active-accent, var(--border-focus));
      border-right-color: var(--active-accent, var(--border-focus));
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
      flex-shrink: 0;
    }

    /* ── Result cards ── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 10px;
      animation: cardIn 0.2s ease both;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 7px;
      flex-wrap: wrap;
    }

    .card-title { font-weight: 600; font-size: 12px; }

    .summary-text { font-size: 12px; line-height: 1.65; }

    .badge-sev {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 8px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .badge-low      { background: var(--sev-low-bg);  color: var(--sev-low-fg); }
    .badge-medium   { background: var(--sev-med-bg);  color: var(--sev-med-fg); }
    .badge-high     { background: var(--sev-high-bg); color: var(--sev-high-fg); }
    .badge-critical { background: var(--sev-crit-bg); color: var(--sev-crit-fg); }

    .issue-desc {
      font-size: 12px;
      margin-bottom: 6px;
    }

    .suggestion-box {
      background: var(--bg-code);
      border-left: 3px solid var(--active-accent, var(--border-focus));
      border-radius: 0 3px 3px 0;
      padding: 7px 10px;
      font-size: 11px;
      margin-bottom: 8px;
    }

    .suggestion-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.55;
      margin-bottom: 3px;
    }

    pre {
      background: var(--bg-code);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 0;
    }

    pre code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.87em;
    }

    .section-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 14px 0 7px;
      opacity: 0.7;
    }

    .refactored-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .copy-btn {
      background: transparent;
      color: var(--fg-body);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 9px;
      font-size: 10px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      transition: border-color 0.15s;
    }

    .copy-btn:hover { border-color: var(--border-focus); }

    .no-issues {
      font-size: 12px;
      color: var(--fg-muted);
    }

    .error-box {
      background: var(--bg-error);
      border: 1px solid var(--border-error);
      border-radius: 4px;
      padding: 9px 12px;
      font-size: 12px;
    }

    /* ── Ripple ── */
    .ripple {
      position: absolute;
      border-radius: 50%;
      width: 80px; height: 80px;
      margin-top: -40px; margin-left: -40px;
      background: var(--ripple-color);
      transform: scale(0);
      animation: ripple-out 0.45s ease-out;
      pointer-events: none;
    }

    /* ── Animations ── */
    @keyframes spin       { to { transform: rotate(360deg); } }
    @keyframes cardIn     { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes ripple-out { to { transform: scale(4); opacity: 0; } }
    @keyframes panelIn    { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: none; } }

    @media (prefers-reduced-motion: reduce) {
      *, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }

    /* ── Debug Checker ── */
    #debug-section {
      margin-top: 20px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-panel);
    }

    #debug-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
    }

    #debug-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #debug-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-debug);
    }

    #debug-sub {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 1px;
    }

    #debug-run-btn {
      background: var(--color-debug);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      letter-spacing: 0.02em;
      transition: opacity 0.15s ease, transform 0.15s ease;
      flex-shrink: 0;
    }

    #debug-run-btn:hover:not(:disabled) { opacity: 0.82; transform: translateY(-1px); }
    #debug-run-btn:disabled { opacity: 0.35; cursor: not-allowed; }

    #debug-output {
      padding: 14px 18px;
      font-size: 12px;
      min-height: 44px;
    }

    .debug-result {
      border-left: 3px solid var(--color-debug);
      background: var(--bg-card);
      border-radius: 0 5px 5px 0;
      padding: 9px 12px;
      margin-bottom: 9px;
      animation: cardIn 0.2s ease both;
    }

    .debug-result.unknown {
      border-left-color: var(--border);
      opacity: 0.8;
    }

    .debug-result-line {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-debug);
      margin-bottom: 4px;
      opacity: 0.8;
    }

    .debug-result.unknown .debug-result-line {
      color: var(--fg-muted);
    }

    .debug-diagnosis {
      line-height: 1.55;
    }

    .debug-raw {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.87em;
      color: var(--fg-muted);
      margin-top: 5px;
      word-break: break-all;
    }

    .debug-clean {
      color: var(--fg-muted);
      font-size: 12px;
    }

    /* ── Cheatsheet ── */
    #cheatsheet-section {
      margin-top: 20px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-panel);
    }

    #cheatsheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      gap: 12px;
    }

    #cheatsheet-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-cheatsheet);
    }

    #cheatsheet-sub {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 1px;
    }

    #cheatsheet-select {
      background: var(--bg-panel);
      color: var(--fg-body);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      flex-shrink: 0;
      max-width: 210px;
    }

    #cheatsheet-select:focus {
      outline: 2px solid var(--border-focus);
      outline-offset: -1px;
    }

    #cheatsheet-select:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    #cheatsheet-body {
      padding: 14px 18px;
    }

    #cheatsheet-copy-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8px;
    }

    #cheatsheet-body pre {
      margin: 0;
    }

    #cheatsheet-unsupported {
      padding: 14px 18px;
    }

    /* ── Help ── */
    #help-section {
      margin-top: 20px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-panel);
    }

    #help-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
    }

    #help-header.open {
      border-bottom: 1px solid var(--border);
    }

    #help-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--fg-body);
    }

    #help-sub {
      font-size: 11px;
      color: var(--fg-muted);
      margin-top: 1px;
    }

    #help-toggle-btn {
      background: transparent;
      color: var(--fg-body);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      flex-shrink: 0;
      transition: border-color 0.15s, opacity 0.15s;
    }

    #help-toggle-btn:hover { border-color: var(--border-focus); opacity: 0.85; }

    #help-body:not([hidden]) {
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .help-tip {
      border-left: 3px solid var(--border);
      background: var(--bg-card);
      border-radius: 0 5px 5px 0;
      padding: 9px 12px;
    }

    .help-tip-title {
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .help-tip-body {
      font-size: 11px;
      color: var(--fg-muted);
      line-height: 1.6;
    }

    .help-tip.tip-warn { border-left-color: var(--border-warn); }
    .help-tip.tip-info { border-left-color: var(--border-focus); }
    ${getAnimationStyles()}
  </style>
</head>
<body>
  <div id="header">
    <h2>${escapeHtml(fileName)}</h2>
    <span class="badge">${escapeHtml(language)}</span>
  </div>


  <!-- C O D E bar -->
  <div id="code-bar" role="tablist" aria-label="Review modes">
    <button class="code-btn" data-mode="CLARIFY"       role="tab" aria-selected="false" aria-controls="mode-panel" aria-label="Clarify mode">
      <span class="letter" aria-hidden="true">C</span>
      <span class="btn-label">Clarify</span>
    </button>
    <button class="code-btn" data-mode="OVERSIGHT"     role="tab" aria-selected="false" aria-controls="mode-panel" aria-label="Oversight mode">
      <span class="letter" aria-hidden="true">O</span>
      <span class="btn-label">Oversight</span>
    </button>
    <button class="code-btn" data-mode="DOCUMENTATION" role="tab" aria-selected="false" aria-controls="mode-panel" aria-label="Document mode">
      <span class="letter" aria-hidden="true">D</span>
      <span class="btn-label">Document</span>
    </button>
    <button class="code-btn" data-mode="EFFICIENCY"    role="tab" aria-selected="false" aria-controls="mode-panel" aria-label="Efficiency mode">
      <span class="letter" aria-hidden="true">E</span>
      <span class="btn-label">Efficiency</span>
    </button>
  </div>

  <!-- Mode panel (hidden until a mode is selected) -->
  <div id="mode-panel" role="tabpanel" hidden>
    <div id="panel-info">
      <h2 id="panel-title"></h2>
      <ul id="panel-bullets"></ul>
      <button id="run-btn">Run</button>
    </div>
    <div id="output-section"></div>
  </div>

  <!-- Debug Checker -->
  <div id="debug-section">
    <div id="debug-header">
      <div id="debug-header-left">
        <div>
          <div id="debug-title">Debug Checker</div>
          <div id="debug-sub">Runs your file and explains any errors found.</div>
        </div>
      </div>
      <button id="debug-run-btn">Run &amp; Diagnose</button>
    </div>
    <div id="debug-output"></div>
  </div>

  <!-- Cheatsheet -->
  <div id="cheatsheet-section">
    <div id="cheatsheet-header">
      <div>
        <div id="cheatsheet-title">Cheatsheet</div>
        <div id="cheatsheet-sub">Beginner quick reference &middot; <strong>${escapeHtml(language)}</strong></div>
      </div>
      <select id="cheatsheet-select" aria-label="Select a topic">
        <option value="">&#8212; pick a topic &#8212;</option>
      </select>
    </div>
    <div id="cheatsheet-body" hidden>
      <div id="cheatsheet-copy-row">
        <button class="copy-btn" id="cheatsheet-copy-btn">Copy</button>
      </div>
      <pre><code id="cheatsheet-code"></code></pre>
    </div>
    <div id="cheatsheet-unsupported" hidden>
      <p class="debug-clean">No cheatsheet available for <strong>${escapeHtml(language)}</strong> yet.</p>
    </div>
  </div>

  <!-- Help -->
  <div id="help-section">
    <div id="help-header">
      <div>
        <div id="help-title">Help &amp; Common Issues</div>
        <div id="help-sub">Things to try when something isn't working</div>
      </div>
      <button id="help-toggle-btn">Open</button>
    </div>
    <div id="help-body" hidden>

      <div class="help-tip tip-warn">
        <div class="help-tip-title">Switched languages? Restart the extension panel.</div>
        <div class="help-tip-body">
          If you opened the panel on a Python file and then switch to JavaScript (or any other language),
          close this panel and reopen it with <strong>Open Code Review</strong> from the command palette.
          The Debug Checker and Cheatsheet are tied to the language at panel-open time.
        </div>
      </div>

      <div class="help-tip tip-warn">
        <div class="help-tip-title">Debug Checker says "not supported" for my language.</div>
        <div class="help-tip-body">
          The Debug Checker can run: JavaScript, TypeScript, Python, Go, Java, C, C++, and Rust.
          Make sure VS Code has detected the correct language and check the badge in the top-right of this panel.
          If it shows the wrong language, set it manually via the language selector in VS Code's status bar.
        </div>
      </div>

      <div class="help-tip tip-warn">
        <div class="help-tip-title">C or C++ takes a long time before "Run &amp; Diagnose" works.</div>
        <div class="help-tip-body">
          C and C++ files must be compiled before they can run. Compilation starts automatically when
          you open this panel. If you click "Run &amp; Diagnose" before it finishes, it will show
          "Compiling…" and wait. Heavy headers like <code>#include &lt;bits/stdc++.h&gt;</code>
          can take 10–15 seconds on the first run. Subsequent runs on the same file are near-instant.
        </div>
      </div>

      <div class="help-tip tip-info">
        <div class="help-tip-title">AI review isn't working (Ollama error).</div>
        <div class="help-tip-body">
          The C, O, D, E review modes need Ollama running locally. Make sure you have started it
          (<code>ollama serve</code>) and that the model is pulled
          (<code>ollama pull qwen2.5-coder:7b</code>). The Debug Checker does <em>not</em> need
          Ollama — it works offline.
        </div>
      </div>

      <div class="help-tip tip-info">
        <div class="help-tip-title">Debug Checker shows "No errors detected" but my program is wrong.</div>
        <div class="help-tip-body">
          The checker only reads <strong>stderr</strong> (error output), not stdout or the exit code.
          Logic errors that produce wrong output without crashing won't be caught here — use the
          AI review modes (C, O, D, E) to analyse the logic instead.
        </div>
      </div>

      <div class="help-tip tip-info">
        <div class="help-tip-title">Errors are showing from a previous version of my file.</div>
        <div class="help-tip-body">
          The Debug Checker now auto-saves before running, so this should be rare. If you still see
          stale results, save manually with <strong>Cmd+S</strong> (Mac) or <strong>Ctrl+S</strong>
          (Windows/Linux) and click "Run &amp; Diagnose" again.
        </div>
      </div>

      <div class="help-tip tip-info">
        <div class="help-tip-title">My program expects keyboard input and hangs.</div>
        <div class="help-tip-body">
          The Debug Checker runs your file with a 15-second timeout and no interactive input.
          If your program calls <code>input()</code>, <code>scanf()</code>, <code>readline()</code>,
          or similar, it will hang until the timeout. Temporarily remove or comment out the input
          calls while debugging, then add them back.
        </div>
      </div>

    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const MODES = {
      CLARIFY: {
        title: 'Clarify Mode',
        bullets: [
          'Analyzes and explains unclear or complex code sections',
          'Identifies confusing logic, poor naming, and misleading structure',
        ],
        runLabel: 'Run',
      },
      OVERSIGHT: {
        title: 'Oversight Mode',
        bullets: [
          'Scans code for security vulnerabilities and performance issues',
          'Detects unsafe operations, injection risks, and missing validation',
        ],
        runLabel: 'Run',
      },
      DOCUMENTATION: {
        title: 'Document Mode',
        bullets: [
          'Generates inline comments and documentation for functions and classes',
          'Flags missing or incorrect docs, unclear parameters, and undocumented APIs',
        ],
        runLabel: 'Run',
      },
      EFFICIENCY: {
        title: 'Efficiency Mode',
        bullets: [
          'Suggests algorithmic improvements and code refactors',
          'Detects redundant operations, unnecessary allocations, and bottlenecks',
        ],
        runLabel: 'Run',
      },
    };

    // Per-mode result cache: mode -> { status: 'idle'|'loading'|'done'|'error', html, copyHooks }
    const cache = {};
    Object.keys(MODES).forEach(m => { cache[m] = { status: 'idle', html: '', copyHooks: [] }; });

    let activeMode = null;
    let isRunning = false;

    const codeBar     = document.getElementById('code-bar');
    const modePanel   = document.getElementById('mode-panel');
    const panelTitle  = document.getElementById('panel-title');
    const panelBullets = document.getElementById('panel-bullets');
    const runBtn      = document.getElementById('run-btn');
    const outputSection = document.getElementById('output-section');

    // ── Helpers ──
    function escapeHtml(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function getAccentVar(mode) {
      const map = {
        CLARIFY:       'var(--color-c)',
        OVERSIGHT:     'var(--color-o)',
        DOCUMENTATION: 'var(--color-d)',
        EFFICIENCY:    'var(--color-e)',
      };
      return map[mode] || 'var(--vscode-button-background)';
    }

    function addRipple(btn, e) {
      const r = document.createElement('span');
      r.className = 'ripple';
      const rect = btn.getBoundingClientRect();
      r.style.left = (e.clientX - rect.left) + 'px';
      r.style.top  = (e.clientY - rect.top)  + 'px';
      btn.appendChild(r);
      r.addEventListener('animationend', () => r.remove());
    }

    // ── Mode selection ──
    document.querySelectorAll('.code-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        addRipple(btn, e);
        const mode = btn.getAttribute('data-mode');
        if (activeMode === mode && !modePanel.hidden) return; // already open
        openMode(mode);
      });

      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      });
    });

    function openMode(mode) {
      // Update bar buttons
      document.querySelectorAll('.code-btn').forEach(b => {
        const selected = b.getAttribute('data-mode') === mode;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-selected', selected ? 'true' : 'false');
      });

      codeBar.classList.add('panel-open');
      modePanel.hidden = false;

      // Fade transition
      const accent = getAccentVar(mode);
      modePanel.style.transition = 'opacity 0.12s ease';
      modePanel.style.opacity = activeMode && activeMode !== mode ? '0' : '1';

      const render = () => {
        activeMode = mode;
        document.documentElement.style.setProperty('--active-accent', accent);

        // Panel info
        panelTitle.textContent = MODES[mode].title;
        panelBullets.innerHTML = MODES[mode].bullets.map(b => '<li>' + escapeHtml(b) + '</li>').join('');
        runBtn.textContent = cache[mode].status === 'loading' ? 'Running…' : MODES[mode].runLabel;
        runBtn.disabled = cache[mode].status === 'loading' || isRunning;

        // Output
        renderOutput(mode);

        modePanel.style.opacity = '1';
      };

      if (modePanel.style.opacity === '0') {
        setTimeout(render, 120);
      } else {
        render();
      }
    }

    function renderOutput(mode) {
      const c = cache[mode];
      if (c.status === 'idle') {
        outputSection.innerHTML = '';
        return;
      }
      if (c.status === 'loading') {
        outputSection.innerHTML =
          '<div class="output-loading"><span class="spinner"></span><span>Running ' + escapeHtml(MODES[mode].runLabel.replace('Run ', '').toLowerCase()) + '…</span></div>';
        return;
      }
      outputSection.innerHTML = c.html;
      // Re-attach copy hooks
      c.copyHooks.forEach(({ btnId, codeId }) => {
        const btn = document.getElementById(btnId);
        const el  = document.getElementById(codeId);
        if (btn && el) {
          btn.addEventListener('click', () => {
            navigator.clipboard.writeText(el.textContent || '').then(() => {
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            });
          });
        }
      });
    }

    // ── Run ──
    runBtn.addEventListener('click', e => {
      addRipple(runBtn, e);
      if (!activeMode || isRunning) return;
      isRunning = true;
      cache[activeMode].status = 'loading';
      cache[activeMode].copyHooks = [];
      runBtn.textContent = 'Running…';
      runBtn.disabled = true;
      renderOutput(activeMode);
      vscode.postMessage({ type: 'startReview', modes: [activeMode] });
    });

    // ── Messages from extension ──
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'modeResult':
          buildResultHtml(msg.mode, msg.data);
          if (activeMode === msg.mode) renderOutput(msg.mode);
          break;

        case 'modeError':
          cache[msg.mode].status = 'error';
          cache[msg.mode].html = '<div class="error-box">' + escapeHtml(msg.message) + '</div>';
          if (activeMode === msg.mode) renderOutput(msg.mode);
          break;

        case 'allDone':
          isRunning = false;
          if (activeMode) {
            runBtn.textContent = MODES[activeMode].runLabel;
            runBtn.disabled = false;
          }
          break;

        case 'error':
          isRunning = false;
          if (activeMode) {
            cache[activeMode].status = 'error';
            cache[activeMode].html = '<div class="error-box">' + escapeHtml(msg.message || 'An unexpected error occurred.') + '</div>';
            renderOutput(activeMode);
            runBtn.textContent = MODES[activeMode].runLabel;
            runBtn.disabled = false;
          }
          break;
      }
    });

    // ── Build result HTML into cache ──
    function buildResultHtml(mode, data) {
      const parts = [];
      const hooks = [];

      // Summary
      parts.push(
        '<div class="card">' +
          '<div class="card-header"><span class="card-title">Summary</span></div>' +
          '<p class="summary-text">' + escapeHtml(data.summary) + '</p>' +
        '</div>'
      );

      // Issues
      if (data.issues && data.issues.length > 0) {
        parts.push('<div class="section-label">Issues (' + data.issues.length + ')</div>');
        data.issues.forEach((issue, idx) => {
          let html =
            '<div class="card" style="animation-delay:' + (idx * 50) + 'ms">' +
              '<div class="card-header">' +
                '<span class="card-title">' + escapeHtml(issue.type) + '</span>' +
                '<span class="badge-sev badge-' + escapeHtml(issue.severity) + '">' + escapeHtml(issue.severity.toUpperCase()) + '</span>' +
              '</div>' +
              '<p class="issue-desc">' + escapeHtml(issue.description) + '</p>' +
              '<div class="suggestion-box">' +
                '<div class="suggestion-label">Suggestion</div>' +
                escapeHtml(issue.suggestion) +
              '</div>';
          if (issue.code_fix) {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = issue.code_fix;
            pre.appendChild(code);
            html += pre.outerHTML;
          }
          html += '</div>';
          parts.push(html);
        });
      } else {
        parts.push('<div class="card"><p class="no-issues">No issues found.</p></div>');
      }

      // Refactored code (model may omit this for some modes)
      if (data.refactored_code) {
        const copyId = 'copy-' + mode;
        const codeId = 'ref-' + mode;
        const refPre = document.createElement('pre');
        const refCode = document.createElement('code');
        refCode.id = codeId;
        refCode.textContent = data.refactored_code;
        refPre.appendChild(refCode);

        parts.push('<div class="section-label">Refactored Code</div>');
        parts.push(
          '<div class="card">' +
            '<div class="refactored-header">' +
              '<span class="card-title">Improved Version</span>' +
              '<button class="copy-btn" id="' + copyId + '">Copy</button>' +
            '</div>' +
            refPre.outerHTML +
          '</div>'
        );

        hooks.push({ btnId: copyId, codeId });
      }

      cache[mode].status = 'done';
      cache[mode].html = parts.join('');
      cache[mode].copyHooks = hooks;
    }

    // ── Debug Checker ──
    const debugRunBtn  = document.getElementById('debug-run-btn');
    const debugOutput  = document.getElementById('debug-output');

    debugRunBtn.addEventListener('click', () => {
      debugRunBtn.disabled = true;
      debugRunBtn.textContent = 'Running…';
      debugOutput.innerHTML = '<div class="output-loading"><span class="spinner"></span><span>Running file…</span></div>';
      vscode.postMessage({ type: 'runDebug' });
    });

    // ── Cheatsheet ──
    const CHEATSHEET_LANG = '${cheatsheetLang}';
    const CHEATSHEET = JSON.parse(atob('${cheatsheetB64}'));
    const CHEATSHEET_TOPICS = ${JSON.stringify(CHEATSHEET_TOPICS)};

    const cheatsheetSelect     = document.getElementById('cheatsheet-select');
    const cheatsheetBody       = document.getElementById('cheatsheet-body');
    const cheatsheetCode       = document.getElementById('cheatsheet-code');
    const cheatsheetCopyBtn    = document.getElementById('cheatsheet-copy-btn');
    const cheatsheetUnsupported = document.getElementById('cheatsheet-unsupported');

    // Populate dropdown
    CHEATSHEET_TOPICS.forEach(topic => {
      const opt = document.createElement('option');
      opt.value = topic;
      opt.textContent = topic;
      cheatsheetSelect.appendChild(opt);
    });

    // Show unsupported notice if language has no cheatsheet
    if (!CHEATSHEET[CHEATSHEET_LANG]) {
      cheatsheetUnsupported.hidden = false;
      cheatsheetSelect.disabled = true;
    }

    cheatsheetSelect.addEventListener('change', () => {
      const topic = cheatsheetSelect.value;
      if (!topic) { cheatsheetBody.hidden = true; return; }
      const snippet = CHEATSHEET[CHEATSHEET_LANG]?.[topic];
      if (!snippet) { cheatsheetBody.hidden = true; return; }
      cheatsheetCode.textContent = snippet;
      cheatsheetBody.hidden = false;
    });

    cheatsheetCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(cheatsheetCode.textContent || '').then(() => {
        cheatsheetCopyBtn.textContent = 'Copied!';
        setTimeout(() => { cheatsheetCopyBtn.textContent = 'Copy'; }, 1500);
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'debugStatus') {
        debugOutput.innerHTML = '<div class="output-loading"><span class="spinner"></span><span>' + escapeHtml(msg.message) + '</span></div>';
        return;
      }
      if (msg.type !== 'debugResult') return;

      debugRunBtn.disabled = false;
      debugRunBtn.textContent = 'Run & Diagnose';

      if (msg.clean) {
        debugOutput.innerHTML = '<p class="debug-clean">✓ No errors detected.</p>';
        return;
      }

      if (msg.unsupported) {
        debugOutput.innerHTML = '<p class="debug-clean">Running <strong>' + escapeHtml(msg.language) + '</strong> files is not supported yet.</p>';
        return;
      }

      const results = msg.results || [];
      if (results.length === 0) {
        debugOutput.innerHTML = '<p class="debug-clean">No output captured.</p>';
        return;
      }

      debugOutput.innerHTML = results.map((r, i) => {
        const lineText = r.line !== null ? 'Line ' + r.line : 'Unknown line';
        if (r.understood) {
          return '<div class="debug-result" style="animation-delay:' + (i * 60) + 'ms">' +
            '<div class="debug-result-line">' + escapeHtml(lineText) + '</div>' +
            '<div class="debug-diagnosis">Based on the error messages, your error is most likely: <strong>' + escapeHtml(r.diagnosis) + '</strong></div>' +
            '<div class="debug-raw">' + escapeHtml(r.errorText) + '</div>' +
          '</div>';
        } else {
          return '<div class="debug-result unknown" style="animation-delay:' + (i * 60) + 'ms">' +
            '<div class="debug-result-line">' + escapeHtml(lineText) + '</div>' +
            '<div class="debug-diagnosis">Sorry, I do not understand this error message.</div>' +
            '<div class="debug-raw">' + escapeHtml(r.errorText) + '</div>' +
          '</div>';
        }
      }).join('');
    });

    // ── Help toggle — handled by animations.ts ──
    ${getAnimationScripts()}
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function deactivate() {}
