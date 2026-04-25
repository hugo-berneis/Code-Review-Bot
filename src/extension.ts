import * as vscode from 'vscode';
import { exec } from 'child_process';
import { readFile, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { DiagnosisResult, ErrorPattern, ERROR_LIBRARY, extractLineNumber, diagnoseOutput } from './errorLibrary';

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
	refactored_code: string;
}

//level of problem severity that need to be fixed
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function isReviewResult(val: unknown): val is ReviewResult {
	if (typeof val !== 'object' || val === null) return false;
	const v = val as Record<string, unknown>;
	if (typeof v.summary !== 'string') return false;
	if (typeof v.refactored_code !== 'string') return false;
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

// ── Debug Helper ─────────────────────────────────────────────────────────────

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

	const listener = panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'startReview') {
			const modes = (msg.modes as string[]).filter(
				m => m === 'CLARIFY' || m === 'EFFICIENCY' || m === 'DOCUMENTATION' || m === 'OVERSIGHT'
			) as ReviewMode[];
			if (modes.length === 0) {
				panel.webview.postMessage({ type: 'error', message: 'No valid modes selected.' });
				return;
			}
			runReviews(panel, code, language, modes);
		}
		if (msg.type === 'runDebug') {
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

function getWebviewContent(fileName: string, language: string): string {
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
      --color-debug:     #7A1CAC;  /* debug section accent & header color  */
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

    /* ── Debug Helper ── */
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

  <!-- Debug Helper -->
  <div id="debug-section">
    <div id="debug-header">
      <div id="debug-header-left">
        <div>
          <div id="debug-title">Debug Helper</div>
          <div id="debug-sub">Explains errors and helps you debug them.</div>
        </div>
      </div>
      <button id="debug-run-btn">Run &amp; Diagnose</button>
    </div>
    <div id="debug-output"></div>
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

      // Refactored code
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

      cache[mode].status = 'done';
      cache[mode].html = parts.join('');
      cache[mode].copyHooks = hooks;
    }

    // ── Debug Helper ──
    const debugRunBtn  = document.getElementById('debug-run-btn');
    const debugOutput  = document.getElementById('debug-output');

    debugRunBtn.addEventListener('click', () => {
      debugRunBtn.disabled = true;
      debugRunBtn.textContent = 'Running…';
      debugOutput.innerHTML = '<div class="output-loading"><span class="spinner"></span><span>Running file…</span></div>';
      vscode.postMessage({ type: 'runDebug' });
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
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function deactivate() {}
