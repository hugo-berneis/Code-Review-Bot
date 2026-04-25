// errorLibrary.ts — pattern-based error diagnosis, no AI

export interface DiagnosisResult {
	line: number | null;
	errorText: string;
	diagnosis: string;
	understood: boolean;
}

export interface ErrorPattern {
	pattern: RegExp;
	explain: (m: RegExpMatchArray) => string;
	lang?: string;
}

// Tags a batch of patterns with a language key for indexed lookup.
function _lang(lang: string, patterns: ErrorPattern[]): ErrorPattern[] {
	return patterns.map(p => ({ ...p, lang }));
}

export const ERROR_LIBRARY: ErrorPattern[] = [

	..._lang('js', [
	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — TypeError (null / undefined access)
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /TypeError: Cannot read propert(?:y|ies) ['"]?(\S+?)['"]? of (undefined|null)/i,
		explain: m => `You are trying to access "${m[1]}" on a value that is ${m[2]}. The object does not exist at this point. Add a null check before accessing it, e.g. if (obj) { obj.${m[1]} }.`,
	},
	{
		pattern: /TypeError: Cannot read properties of (undefined|null) \(reading ['"](.+?)['"]\)/i,
		explain: m => `You are trying to read the property "${m[2]}" on a value that is ${m[1]}. The variable has not been assigned yet or has been set to ${m[1]} earlier in the code.`,
	},
	{
		pattern: /TypeError: Cannot set propert(?:y|ies) ['"]?(\S+?)['"]? of (undefined|null)/i,
		explain: m => `You are trying to set "${m[1]}" on a value that is ${m[2]}. The object does not exist. Initialise it before assigning properties to it.`,
	},
	{
		pattern: /TypeError: Cannot set properties of (undefined|null) \(setting ['"](.+?)['"]\)/i,
		explain: m => `You are trying to set the property "${m[2]}" on a value that is ${m[1]}. Make sure the object is created before you assign to it.`,
	},
	{
		pattern: /TypeError: Cannot destructure property ['"]?(\S+?)['"]? of ['"]?(\S+?)['"]? as it is (undefined|null)/i,
		explain: m => `You are trying to destructure the property "${m[1]}" from "${m[2]}" but it is ${m[3]}. Make sure the value exists before destructuring.`,
	},
	{
		pattern: /TypeError: (undefined|null) is not an object \(evaluating ['"](.+?)['"]\)/i,
		explain: m => `The expression "${m[2]}" evaluated to ${m[1]}. This is the Safari equivalent of "Cannot read property". Check that the object exists before accessing it.`,
	},
	{
		pattern: /TypeError: Cannot convert (undefined|null) to object/i,
		explain: m => `A built-in function like Object.keys() or Object.entries() received ${m[1]} instead of an object. Check what you are passing to it.`,
	},
	{
		pattern: /TypeError: (undefined|null) is not iterable/i,
		explain: m => `You are trying to iterate over ${m[1]} with for...of, spread, or destructuring. The value must be an array, string, or other iterable object.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — TypeError (function calls)
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /TypeError: (\S+) is not a function/i,
		explain: m => `"${m[1]}" is being called as a function but it is not one. Check the spelling and that the variable actually holds a function.`,
	},
	{
		pattern: /TypeError: (\S+)\.(\S+) is not a function/i,
		explain: m => `"${m[1]}.${m[2]}" is not a function. Either "${m[1]}" is not the type you expect, or the method "${m[2]}" does not exist on it.`,
	},
	{
		pattern: /TypeError: Class constructor (\S+) cannot be invoked without 'new'/i,
		explain: m => `The class "${m[1]}" must be called with the "new" keyword. Change the call to: new ${m[1]}(...).`,
	},
	{
		pattern: /TypeError: Cannot call a class as a function/i,
		explain: () => `A class is being called without the "new" keyword. Add "new" before the class name.`,
	},
	{
		pattern: /TypeError: (\S+) is not a constructor/i,
		explain: m => `"${m[1]}" cannot be used with "new" because it is not a constructor. Arrow functions and some built-ins cannot be instantiated.`,
	},
	{
		pattern: /TypeError: Reduce of empty array with no initial value/i,
		explain: () => `You called .reduce() on an empty array without providing an initial value as the second argument. Either check the array is non-empty first, or pass a sensible default as the second argument to reduce().`,
	},
	{
		pattern: /TypeError: (\S+) \(\.\.\.\) is not a function/i,
		explain: m => `The return value of a function call is not itself a function. "${m[1]}(...)" returned something that you are then trying to call. Check what the first call actually returns.`,
	},
	{
		pattern: /TypeError: (\S+)\.forEach is not a function/i,
		explain: m => `"${m[1]}" is not an array (or iterable) so .forEach() does not exist on it. Check the type of this variable.`,
	},
	{
		pattern: /TypeError: (\S+)\.map is not a function/i,
		explain: m => `"${m[1]}" is not an array so .map() does not exist on it. Ensure the variable is an array before calling .map().`,
	},
	{
		pattern: /TypeError: (\S+)\.filter is not a function/i,
		explain: m => `"${m[1]}" is not an array so .filter() does not exist on it. Ensure the variable is an array before calling .filter().`,
	},
	{
		pattern: /TypeError: (\S+)\.then is not a function/i,
		explain: m => `"${m[1]}" is not a Promise. You are chaining .then() on a value that was not returned as a Promise. Check that your function is async or returns a Promise.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — TypeError (assignment / type)
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /TypeError: Assignment to constant variable/i,
		explain: () => `You are trying to reassign a variable declared with "const". Change the declaration to "let" if you need to reassign it.`,
	},
	{
		pattern: /TypeError: Invalid assignment to const ['"](\S+?)['"]/i,
		explain: m => `"${m[1]}" was declared with const and cannot be reassigned. Use "let" instead of "const" if you need to change its value.`,
	},
	{
		pattern: /TypeError: (\S+) is read-only/i,
		explain: m => `"${m[1]}" is a read-only property and cannot be assigned to. In strict mode, silently ignored writes become errors.`,
	},
	{
		pattern: /TypeError: Cannot add property (\S+), object is not extensible/i,
		explain: m => `You are trying to add the property "${m[1]}" to a sealed or frozen object. Use Object.freeze() carefully, or avoid Object.preventExtensions() if you need to add properties.`,
	},
	{
		pattern: /TypeError: (\d+) is not a valid array length/i,
		explain: m => `You are trying to create an array with length ${m[1]}, which is not valid. Array length must be a non-negative integer less than 2^32.`,
	},
	{
		pattern: /TypeError: cyclic object value/i,
		explain: () => `You are trying to JSON.stringify() an object that contains a circular reference (an object that references itself). Remove the circular reference or use a replacer function.`,
	},
	{
		pattern: /TypeError: Converting circular structure to JSON/i,
		explain: () => `JSON.stringify() failed because the object has a circular reference. An object somewhere in the structure points back to a parent. Remove the cycle or use a custom serialiser.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — ReferenceError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /ReferenceError: (\S+) is not defined/i,
		explain: m => `"${m[1]}" is being used but has never been declared. Check the spelling and make sure it is declared before use.`,
	},
	{
		pattern: /ReferenceError: Cannot access ['"](\S+?)['"] before initialization/i,
		explain: m => `"${m[1]}" is declared with let or const but is being accessed before its declaration line. This is the "temporal dead zone". Move the declaration above the usage.`,
	},
	{
		pattern: /ReferenceError: (\S+) is not defined.*strict mode/i,
		explain: m => `In strict mode, using an undeclared variable "${m[1]}" is an error. Declare it with let, const, or var first.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — SyntaxError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /SyntaxError: Unexpected token ['"]?(.+?)['"]?(?:\s|$)/i,
		explain: m => `Syntax error near the token "${m[1].trim()}". Check for missing brackets, commas, semicolons, or operators around this point.`,
	},
	{
		pattern: /SyntaxError: Unexpected end of (?:JSON )?input/i,
		explain: () => `The code or JSON ends unexpectedly. You are likely missing a closing bracket, brace, or parenthesis.`,
	},
	{
		pattern: /SyntaxError: Unexpected identifier ['"]?(.+?)['"]?/i,
		explain: m => `The identifier "${m[1]}" appeared where it was not expected. A comma, semicolon, or operator may be missing before it.`,
	},
	{
		pattern: /SyntaxError: Invalid or unexpected token/i,
		explain: () => `A character in the source is not valid in its position. Check for stray characters, non-standard quotes, or invisible unicode characters.`,
	},
	{
		pattern: /SyntaxError: Missing \) after argument list/i,
		explain: () => `A function call is missing a closing parenthesis. Count the opening and closing parentheses in the call.`,
	},
	{
		pattern: /SyntaxError: Missing \} after block statement/i,
		explain: () => `A code block is missing its closing brace. Count the opening and closing braces in your functions or control structures.`,
	},
	{
		pattern: /SyntaxError: Unexpected reserved word/i,
		explain: () => `A reserved keyword is being used in an unexpected place. For example, using "await" outside an async function, or "yield" outside a generator.`,
	},
	{
		pattern: /SyntaxError: await is only valid in async functions/i,
		explain: () => `"await" can only be used inside a function marked with "async". Either mark the containing function as async, or use .then() instead.`,
	},
	{
		pattern: /SyntaxError: Cannot use import statement outside a module/i,
		explain: () => `ES module "import" syntax is not allowed in this context. Either add "type": "module" to package.json, use .mjs extension, or switch to require().`,
	},
	{
		pattern: /SyntaxError: Identifier ['"]?(\S+?)['"]? has already been declared/i,
		explain: m => `"${m[1]}" has already been declared in this scope. Rename one of them or remove the duplicate.`,
	},
	{
		pattern: /SyntaxError: (?:Octal literals|Octal escape sequences) are not allowed in strict mode/i,
		explain: () => `Octal literals like 0755 or octal escape sequences are not allowed in strict mode. Use decimal, hex (0x...), or template literals instead.`,
	},
	{
		pattern: /SyntaxError: rest element must be last element/i,
		explain: () => `The rest parameter (...x) must be the last parameter in a function signature or the last element in a destructuring pattern.`,
	},
	{
		pattern: /SyntaxError: Duplicate parameter name not allowed/i,
		explain: () => `Two parameters in the function have the same name. In strict mode this is always an error. Rename one of them.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — RangeError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /RangeError: Maximum call stack size exceeded/i,
		explain: () => `A function is calling itself with no stopping condition, causing infinite recursion. Add a base case to end the recursion.`,
	},
	{
		pattern: /RangeError: Invalid array length/i,
		explain: () => `You tried to create an array with a negative or non-integer length. Array length must be a non-negative integer.`,
	},
	{
		pattern: /RangeError: toFixed\(\) digits argument must be between 0 and 100/i,
		explain: () => `The argument passed to toFixed() must be between 0 and 100. Check the value you are passing.`,
	},
	{
		pattern: /RangeError: Invalid time value/i,
		explain: () => `A Date constructor received an invalid value. Check the date string or timestamp you are passing — it may be malformed or out of range.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — Node.js system errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /ENOENT: no such file or directory(?:,\s*(?:open|access|scandir|stat|unlink|rename))? ['"](.+?)['"]/i,
		explain: m => `The file or directory "${m[1]}" does not exist. Check the path for typos and make sure the file has been created.`,
	},
	{
		pattern: /EADDRINUSE.*?:?(\d{2,5})/i,
		explain: m => `Port ${m[1]} is already occupied by another process. Stop that process first or change your server to use a different port.`,
	},
	{
		pattern: /EACCES: permission denied['"]?,? ['"]?(.+?)['"]?(?:\s|$)/i,
		explain: m => `Access was denied to "${m[1].trim()}". The current user does not have permission to read, write, or execute it. Check file permissions with ls -la.`,
	},
	{
		pattern: /ECONNREFUSED.*?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})?:?(\d{2,5})?/i,
		explain: m => `The connection was refused${m[1] ? ' to ' + m[1] : ''}${m[2] ? ':' + m[2] : ''}. The target server is not running or is not listening on that port.`,
	},
	{
		pattern: /ETIMEDOUT/i,
		explain: () => `The connection attempt timed out. The server may be unreachable, behind a firewall, or too slow to respond. Check the address and network connectivity.`,
	},
	{
		pattern: /EPERM: operation not permitted/i,
		explain: () => `The operation is not permitted. This usually means the process does not have the required privileges. Try running as administrator or adjusting permissions.`,
	},
	{
		pattern: /EEXIST: file already exists['"]?,? ['"]?(.+?)['"]?/i,
		explain: m => `"${m[1]}" already exists. If you are creating a file, check whether it already exists before creating it, or use a write-with-overwrite flag.`,
	},
	{
		pattern: /EISDIR: illegal operation on a directory['"]?,? ['"]?(.+?)['"]?/i,
		explain: m => `"${m[1]}" is a directory but the operation expected a file. Check the path you are using.`,
	},
	{
		pattern: /ENOTDIR: not a directory['"]?,? ['"]?(.+?)['"]?/i,
		explain: m => `A component of the path "${m[1]}" is not a directory. A file exists where a directory was expected.`,
	},
	{
		pattern: /EMFILE: too many open files/i,
		explain: () => `The process has too many file descriptors open. Close files after use, or increase the system file descriptor limit with ulimit -n.`,
	},
	{
		pattern: /ECONNRESET/i,
		explain: () => `The connection was forcibly closed by the remote side. The server may have crashed, restarted, or enforced a timeout. Add retry logic or check the server.`,
	},
	{
		pattern: /EPIPE: broken pipe/i,
		explain: () => `The pipe was broken because the reader closed the connection before writing finished. This is common when piping output and the consumer exits early.`,
	},
	{
		pattern: /ENOTFOUND: getaddrinfo ENOTFOUND (.+)/i,
		explain: m => `The hostname "${m[1]}" could not be resolved. Check the URL for typos, verify DNS, and make sure you have network connectivity.`,
	},
	{
		pattern: /ERR_MODULE_NOT_FOUND.*['"](.+?)['"]/i,
		explain: m => `The module "${m[1]}" could not be found. Run "npm install" or check that the import path is correct.`,
	},
	{
		pattern: /ERR_REQUIRE_ESM/i,
		explain: () => `You are trying to require() an ES module. ES modules cannot be loaded with require(). Use dynamic import() instead, or switch the file to CommonJS.`,
	},
	{
		pattern: /ERR_INVALID_ARG_TYPE/i,
		explain: () => `A Node.js API received an argument of the wrong type. Check what type the function expects and what you are passing to it.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — async / Promise
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /UnhandledPromiseRejectionWarning|UnhandledPromiseRejection/i,
		explain: () => `A Promise was rejected but no .catch() handler or try/catch block handled it. Wrap your async code in try/catch or chain a .catch() call.`,
	},
	{
		pattern: /TypeError: Cannot read.*async/i,
		explain: () => `An async function returned undefined or null and a property was accessed on it. Make sure you are awaiting the Promise before accessing its result.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — JSON
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /SyntaxError: Unexpected token (.) in JSON at position (\d+)/i,
		explain: m => `JSON.parse() failed at position ${m[2]} because of an unexpected "${m[1]}". The string is not valid JSON — check for single quotes, trailing commas, or comments.`,
	},
	{
		pattern: /SyntaxError: JSON\.parse: (.+?) at line (\d+)/i,
		explain: m => `JSON parsing failed at line ${m[2]}: ${m[1]}. Check the JSON for syntax errors — missing quotes, trailing commas, or incorrect nesting.`,
	},

	// ════════════════════════════════════════════════════════════════
	// TYPESCRIPT — compiler errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error TS2304: Cannot find name ['"](.+?)['"]/i,
		explain: m => `TypeScript cannot find the name "${m[1]}". It may not be declared, or you may be missing an import or a type declaration.`,
	},
	{
		pattern: /error TS2322: Type ['"]?(.+?)['"]? is not assignable to type ['"]?(.+?)['"]?/i,
		explain: m => `You are assigning a value of type "${m[1]}" to something that expects "${m[2]}". Check the types are compatible or add a type assertion.`,
	},
	{
		pattern: /error TS2339: Property ['"](.+?)['"] does not exist on type ['"](.+?)['"]/i,
		explain: m => `The property "${m[1]}" does not exist on type "${m[2]}". Check the spelling, or add the property to the type definition.`,
	},
	{
		pattern: /error TS2345: Argument of type ['"]?(.+?)['"]? is not assignable to parameter of type ['"]?(.+?)['"]?/i,
		explain: m => `You are passing a "${m[1]}" where a "${m[2]}" is expected. Check the function signature and the type of the argument you are passing.`,
	},
	{
		pattern: /error TS2532: Object is possibly ['"]undefined['"]/i,
		explain: () => `A value might be undefined. TypeScript requires you to check for undefined before using it. Use optional chaining (?.) or a null check.`,
	},
	{
		pattern: /error TS2531: Object is possibly ['"]null['"]/i,
		explain: () => `A value might be null. TypeScript requires you to check for null before using it. Use optional chaining (?.) or add a null check.`,
	},
	{
		pattern: /error TS7006: Parameter ['"](.+?)['"] implicitly has an ['"]any['"] type/i,
		explain: m => `The parameter "${m[1]}" has no type annotation so TypeScript infers "any". Add an explicit type: ${m[1]}: YourType.`,
	},
	{
		pattern: /error TS2554: Expected (\d+) arguments?, but got (\d+)/i,
		explain: m => `The function expects ${m[1]} argument(s) but ${m[2]} were provided. Check the function signature.`,
	},
	{
		pattern: /error TS2551: Property ['"](.+?)['"] does not exist on type.*Did you mean ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" does not exist. Did you mean "${m[2]}"? Check the spelling of the property.`,
	},
	{
		pattern: /error TS2741: Property ['"](.+?)['"] is missing in type ['"]?(.+?)['"]? but required in type/i,
		explain: m => `The property "${m[1]}" is required by the type but was not provided in "${m[2]}". Add the missing property.`,
	},
	{
		pattern: /error TS2564: Property ['"](.+?)['"] has no initializer and is not definitely assigned/i,
		explain: m => `"${m[1]}" is declared but never initialised. Either give it a default value, mark it optional with "?", or use the definite assignment assertion "!".`,
	},
	{
		pattern: /error TS2300: Duplicate identifier ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" has been declared more than once. Rename or remove the duplicate.`,
	},
	{
		pattern: /error TS2355: A function whose declared type is neither.*void.*must return a value/i,
		explain: () => `The function declares a return type but some code paths do not return a value. Make sure every branch returns something.`,
	},
	{
		pattern: /error TS1005: ['"](.+?)['"] expected/i,
		explain: m => `TypeScript expected "${m[1]}" here but found something else. Check the syntax around this line.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVASCRIPT / TYPESCRIPT — module
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /Cannot find module ['"](.+?)['"] or its corresponding type declarations/i,
		explain: m => `The module "${m[1]}" was not found. Run "npm install" or check the import path. If it is a third-party package, you may also need "@types/${m[1].replace('@', '').split('/')[0]}".`,
	},
	{
		pattern: /Cannot find module ['"](.+?)['"]/i,
		explain: m => `The module "${m[1]}" cannot be found. Run "npm install" or check that the import path is correct.`,
	},
	{
		pattern: /Module not found: Error: Can't resolve ['"](.+?)['"]/i,
		explain: m => `Webpack cannot find the module "${m[1]}". Check the import path is correct relative to the file, or that the package is installed.`,
	},

	]),

	..._lang('python', [
	// ════════════════════════════════════════════════════════════════
	// PYTHON — IndentationError / TabError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /IndentationError: (.+)/i,
		explain: m => `Indentation error: ${m[1]}. Python uses indentation to define code blocks. Use spaces or tabs consistently — never mix both in the same file.`,
	},
	{
		pattern: /TabError: inconsistent use of tabs and spaces/i,
		explain: () => `You have mixed tabs and spaces for indentation. Python requires one or the other. Configure your editor to use spaces (PEP 8 recommends 4 spaces) and reindent the file.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — SyntaxError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /SyntaxError: EOL while scanning string literal/i,
		explain: () => `A string is not closed before the end of the line. Check for a missing closing quote character.`,
	},
	{
		pattern: /SyntaxError: EOF while scanning triple-quoted string literal/i,
		explain: () => `A triple-quoted string (""" or ''') was opened but never closed. Find the opening triple quote and add the matching closing triple quote.`,
	},
	{
		pattern: /SyntaxError: unexpected EOF while parsing/i,
		explain: () => `Python reached the end of the file unexpectedly. A bracket, parenthesis, or brace is probably not closed.`,
	},
	{
		pattern: /SyntaxError: expected ':'/i,
		explain: () => `A colon is missing. Python requires a colon at the end of if, for, while, def, class, with, and else statements.`,
	},
	{
		pattern: /SyntaxError: cannot assign to (\S+)/i,
		explain: m => `You are trying to assign to ${m[1]}, which is not a valid assignment target. Check the left-hand side of the = sign.`,
	},
	{
		pattern: /SyntaxError: positional argument follows keyword argument/i,
		explain: () => `In a function call, positional arguments must come before keyword arguments. Reorder the arguments so all keyword arguments come last.`,
	},
	{
		pattern: /SyntaxError: invalid escape sequence ['"]\\(.)['"]/i,
		explain: m => `"\\${m[1]}" is not a recognised escape sequence in a string. Use a raw string r"..." or escape the backslash as "\\\\" if you meant a literal backslash.`,
	},
	{
		pattern: /SyntaxError: f-string expression part cannot include a backslash/i,
		explain: () => `You cannot use a backslash inside the {} expression part of an f-string. Compute the value in a variable first, then reference it in the f-string.`,
	},
	{
		pattern: /SyntaxError: 'return' outside function/i,
		explain: () => `A "return" statement is outside of any function. Check the indentation — the return may have been accidentally unindented from its function.`,
	},
	{
		pattern: /SyntaxError: 'break' outside loop/i,
		explain: () => `A "break" statement is outside of a loop. Check the indentation and make sure the break is inside a for or while loop.`,
	},
	{
		pattern: /SyntaxError: 'continue' outside loop/i,
		explain: () => `A "continue" statement is outside of a loop. Check the indentation and make sure the continue is inside a for or while loop.`,
	},
	{
		pattern: /SyntaxError: invalid syntax/i,
		explain: () => `Python cannot parse this line. Common causes: a missing colon at the end of an if/for/def/class statement, mismatched brackets, or using a Python 3 keyword in Python 2 syntax.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — NameError / UnboundLocalError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /NameError: name ['"](.+?)['"] is not defined/i,
		explain: m => `"${m[1]}" is used before it has been defined. Check the spelling and make sure it is assigned before use.`,
	},
	{
		pattern: /UnboundLocalError: local variable ['"](.+?)['"] referenced before assignment/i,
		explain: m => `"${m[1]}" is referenced inside a function before it is assigned. If you intend to use the global variable, add "global ${m[1]}" at the top of the function. Otherwise assign it before use.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — TypeError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /TypeError: unsupported operand type\(s\) for (.+?): ['"](.+?)['"] and ['"](.+?)['"]/i,
		explain: m => `You cannot use the operator "${m[1]}" between types "${m[2]}" and "${m[3]}". Make sure both values are compatible types.`,
	},
	{
		pattern: /TypeError: can only concatenate (.+?) \(not ['"](.+?)['"]\) to (.+)/i,
		explain: m => `You can only concatenate ${m[1]} to ${m[1]}, not ${m[2]}. Convert the other value to ${m[1]} first, e.g. str(value).`,
	},
	{
		pattern: /TypeError: ['"](.+?)['"] object is not subscriptable/i,
		explain: m => `You are using square bracket indexing on a "${m[1]}" object, which does not support it. Check the type of the variable.`,
	},
	{
		pattern: /TypeError: ['"](.+?)['"] object is not callable/i,
		explain: m => `You are trying to call a "${m[1]}" object as a function. Check whether you accidentally overwrote a function name with a value.`,
	},
	{
		pattern: /TypeError: ['"](.+?)['"] object is not iterable/i,
		explain: m => `A "${m[1]}" object cannot be iterated over. You can only use for loops and unpacking on lists, tuples, strings, and other iterables.`,
	},
	{
		pattern: /TypeError: list indices must be integers or slices, not (.+)/i,
		explain: m => `You used a ${m[1]} as a list index. List indices must be integers or slices. If the value is a float, convert it with int().`,
	},
	{
		pattern: /TypeError: string indices must be integers/i,
		explain: () => `You are indexing a string with a non-integer. String indices must be integers. Check what type your index variable is.`,
	},
	{
		pattern: /TypeError: cannot unpack non-(?:iterable|sequence) (.+?) object/i,
		explain: m => `You tried to unpack a "${m[1]}" object but it is not iterable. Unpacking only works on iterables like lists, tuples, or strings.`,
	},
	{
		pattern: /TypeError: unhashable type: ['"](.+?)['"]/i,
		explain: m => `A "${m[1]}" cannot be used as a dictionary key or in a set because it is unhashable (mutable). Use a tuple instead of a list, for example.`,
	},
	{
		pattern: /TypeError: (\S+)\(\) (missing \d+ required positional arguments?): (.+)/i,
		explain: m => `${m[1]}() was called with too few arguments: ${m[2]} (${m[3]}). Check the function signature and provide all required parameters.`,
	},
	{
		pattern: /TypeError: (\S+)\(\) takes (\d+) positional argument(?:s)? but (\d+) (?:were|was) given/i,
		explain: m => `${m[1]}() accepts ${m[2]} positional argument(s) but ${m[3]} were given. Remove the extra arguments.`,
	},
	{
		pattern: /TypeError: (\S+)\(\) got an unexpected keyword argument ['"](.+?)['"]/i,
		explain: m => `${m[1]}() does not accept a keyword argument called "${m[2]}". Check the function signature for the correct parameter names.`,
	},
	{
		pattern: /TypeError: (\S+)\(\) got multiple values for argument ['"](.+?)['"]/i,
		explain: m => `The argument "${m[2]}" was passed both positionally and as a keyword argument to ${m[1]}(). Pass it only once.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — AttributeError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /AttributeError: ['"]?(.+?)['"]? object has no attribute ['"](.+?)['"]/i,
		explain: m => `A "${m[1]}" object does not have an attribute called "${m[2]}". Check the spelling and that you are using the right object type.`,
	},
	{
		pattern: /AttributeError: module ['"](.+?)['"] has no attribute ['"](.+?)['"]/i,
		explain: m => `The module "${m[1]}" does not have an attribute called "${m[2]}". Check for a typo or whether the module version you have installed exposes it.`,
	},
	{
		pattern: /AttributeError: ['"]NoneType['"] object has no attribute ['"](.+?)['"]/i,
		explain: m => `You are trying to access "${m[1]}" on a None value. A function likely returned None when you expected an object. Add a None check.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — ImportError / ModuleNotFoundError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /(?:ModuleNotFoundError|ImportError): No module named ['"](.+?)['"]/i,
		explain: m => `The module "${m[1]}" is not installed. Run "pip install ${m[1].split('.')[0]}" to install it.`,
	},
	{
		pattern: /ImportError: cannot import name ['"](.+?)['"] from ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" does not exist in the module "${m[2]}". Check the spelling or the module version — the name may have changed in a newer release.`,
	},
	{
		pattern: /ImportError: attempted relative import with no known parent package/i,
		explain: () => `A relative import (from . import ...) was used in a script run directly. Relative imports only work inside packages. Run the file as part of a package, or use an absolute import.`,
	},
	{
		pattern: /ImportError: attempted relative import beyond top-level package/i,
		explain: () => `A relative import is going above the top-level package. Check the number of dots used (from .. import) and the package structure.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — LookupError (Key / Index)
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /KeyError: ['"]?(.+?)['"]?\s*$/im,
		explain: m => `The key "${m[1].trim()}" does not exist in the dictionary. Check the key name, or use .get() to provide a default value.`,
	},
	{
		pattern: /IndexError: list index out of range/i,
		explain: () => `You are accessing a list at an index that does not exist. Check the list length with len() before indexing into it.`,
	},
	{
		pattern: /IndexError: tuple index out of range/i,
		explain: () => `You are accessing a tuple at an index that does not exist. Check the number of elements in the tuple.`,
	},
	{
		pattern: /IndexError: string index out of range/i,
		explain: () => `You are indexing a string at a position that does not exist. Check the string length before indexing.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — ArithmeticError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /ZeroDivisionError: division by zero/i,
		explain: () => `The code is dividing by zero. Add a check to make sure the divisor is not zero before performing the division.`,
	},
	{
		pattern: /ZeroDivisionError: float division by zero/i,
		explain: () => `A float division resulted in division by zero. Check your denominator value before dividing.`,
	},
	{
		pattern: /ZeroDivisionError: modulo by zero/i,
		explain: () => `The modulo operator (%) has zero as its right operand. Check that the divisor is not zero.`,
	},
	{
		pattern: /OverflowError: math range error/i,
		explain: () => `A math function produced a result too large for a float. Check the input values — they may be too extreme.`,
	},
	{
		pattern: /OverflowError: \(34, 'Result too large'\)/i,
		explain: () => `A calculation produced a number too large to represent. Consider using Python's arbitrary-precision integers or the decimal module.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — IOError / OSError / FileError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /FileNotFoundError: \[Errno 2\] No such file or directory: ['"](.+?)['"]/i,
		explain: m => `The file "${m[1]}" does not exist. Check the path for typos and make sure the file has been created.`,
	},
	{
		pattern: /PermissionError: \[Errno 13\] Permission denied: ['"](.+?)['"]/i,
		explain: m => `You do not have permission to access "${m[1]}". Check the file permissions or run with elevated privileges.`,
	},
	{
		pattern: /IsADirectoryError: \[Errno 21\]/i,
		explain: () => `A directory path was given where a file was expected. Check the path you are using for open() or file operations.`,
	},
	{
		pattern: /NotADirectoryError: \[Errno 20\]/i,
		explain: () => `A file path was given where a directory was expected. A component of the path is a file, not a directory.`,
	},
	{
		pattern: /ConnectionRefusedError: \[Errno 61\]/i,
		explain: () => `The connection was refused. The target server is not running or is not listening on that port.`,
	},
	{
		pattern: /TimeoutError/i,
		explain: () => `An operation timed out. The server did not respond in time. Check your network connection or increase the timeout value.`,
	},
	{
		pattern: /BrokenPipeError/i,
		explain: () => `The pipe was broken — the reader on the other end closed before all data was written. Handle this exception or check that the consuming process stays alive.`,
	},
	{
		pattern: /ValueError: I\/O operation on closed file/i,
		explain: () => `You are trying to read or write to a file that has already been closed. Make sure you are inside the "with open(...) as f:" block when performing file operations.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — ValueError
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /ValueError: invalid literal for int\(\) with base \d+: ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" cannot be converted to an integer. The string contains non-numeric characters. Strip whitespace or check the format before converting.`,
	},
	{
		pattern: /ValueError: could not convert string to float: ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" cannot be converted to a float. Check that the string contains only a valid number.`,
	},
	{
		pattern: /ValueError: list\.remove\(x\): x not in list/i,
		explain: () => `The value you are trying to remove does not exist in the list. Check whether the value is present before calling .remove(), or use a try/except block.`,
	},
	{
		pattern: /ValueError: not enough values to unpack \(expected (\d+), got (\d+)\)/i,
		explain: m => `Unpacking expected ${m[1]} values but only ${m[2]} were provided. Make sure the right-hand side has the correct number of items.`,
	},
	{
		pattern: /ValueError: too many values to unpack \(expected (\d+)\)/i,
		explain: m => `Unpacking expected ${m[1]} values but more were provided. Use a starred variable (*rest) to capture the extra values, or slice the list first.`,
	},
	{
		pattern: /ValueError: substring not found/i,
		explain: () => `str.index() could not find the substring. Use str.find() instead if you want -1 returned on failure rather than an exception.`,
	},
	{
		pattern: /ValueError: math domain error/i,
		explain: () => `A math function received a value outside its valid domain, e.g. math.sqrt() of a negative number or math.log() of zero. Check the input values.`,
	},

	// ════════════════════════════════════════════════════════════════
	// PYTHON — RuntimeError / other
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /RecursionError: maximum recursion depth exceeded/i,
		explain: () => `A function is calling itself with no base case, exhausting Python's recursion limit. Add a stopping condition, or increase sys.setrecursionlimit() if deep recursion is intentional.`,
	},
	{
		pattern: /RuntimeError: dictionary changed size during iteration/i,
		explain: () => `You added or removed items from a dictionary while iterating over it. Iterate over a copy instead: for k in list(d.keys()).`,
	},
	{
		pattern: /RuntimeError: maximum recursion depth exceeded in comparison/i,
		explain: () => `Infinite recursion occurred during an equality comparison. Check your __eq__ method or the objects being compared.`,
	},
	{
		pattern: /StopIteration/i,
		explain: () => `An iterator ran out of items. If you are calling next() manually, wrap it in a try/except StopIteration block, or use next(iterator, default).`,
	},
	{
		pattern: /AssertionError/i,
		explain: () => `An assert statement failed. The condition evaluated to False. Check what the assertion is testing and why the condition is not met.`,
	},
	{
		pattern: /NotImplementedError/i,
		explain: () => `A method or function has not been implemented yet. If you are subclassing an abstract class, you must implement all abstract methods.`,
	},
	{
		pattern: /UnicodeDecodeError: '(.+?)' codec can't decode byte 0x(.{1,4}) in position (\d+)/i,
		explain: m => `The file or string is not valid ${m[1]} encoding at position ${m[3]}. Try opening the file with a different encoding, e.g. open(f, encoding='latin-1') or 'utf-8-sig'.`,
	},
	{
		pattern: /UnicodeEncodeError: '(.+?)' codec can't encode character/i,
		explain: m => `A character cannot be encoded in ${m[1]}. Use UTF-8 or specify errors='replace'/'ignore' in the encode() call.`,
	},
	{
		pattern: /json\.decoder\.JSONDecodeError: (.+): line (\d+)/i,
		explain: m => `JSON parsing failed at line ${m[2]}: ${m[1]}. The string is not valid JSON — check for single quotes, trailing commas, or comments.`,
	},
	{
		pattern: /MemoryError/i,
		explain: () => `Python ran out of memory. The data structure you are creating is too large. Process data in smaller chunks or use a more memory-efficient data structure.`,
	},
	{
		pattern: /OSError: \[Errno 28\] No space left on device/i,
		explain: () => `The disk is full. Free up disk space before writing more files.`,
	},

	]),

	..._lang('go', [
	// ════════════════════════════════════════════════════════════════
	// GO — compile errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /declared (?:and|but) not used/i,
		explain: () => `A variable is declared but never used. Go does not allow unused variables. Either remove it or use it somewhere in your code.`,
	},
	{
		pattern: /imported and not used: ['"](.+?)['"]/i,
		explain: m => `The package "${m[1]}" is imported but never used. Remove the import or use something from it.`,
	},
	{
		pattern: /undefined: (\S+)/i,
		explain: m => `"${m[1]}" is not defined in this scope. Check the spelling and that the package containing it has been imported.`,
	},
	{
		pattern: /cannot use .+? \((?:variable of )?type (.+?)\) as (?:type )?(.+?) (?:in|value)/i,
		explain: m => `Type mismatch: a value of type "${m[1]}" cannot be used where "${m[2]}" is expected. Check your types or add an explicit conversion.`,
	},
	{
		pattern: /too many arguments in call to (\S+)/i,
		explain: m => `"${m[1]}" is being called with too many arguments. Check the function signature.`,
	},
	{
		pattern: /not enough arguments in call to (\S+)/i,
		explain: m => `"${m[1]}" is being called with too few arguments. Check the function signature and provide all required parameters.`,
	},
	{
		pattern: /multiple-value (\S+) \(.+?\) used in single-value context/i,
		explain: m => `"${m[1]}" returns multiple values but only one is expected here. Assign both return values: val, err := ${m[1]}(...).`,
	},
	{
		pattern: /invalid operation: (.+?) \(operator (.+?) not defined on (.+?)\)/i,
		explain: m => `The operator "${m[2]}" is not defined for type "${m[3]}" in the expression "${m[1]}". Check the types involved.`,
	},
	{
		pattern: /cannot take the address of (.+)/i,
		explain: m => `You cannot take the address of "${m[1].trim()}". You can only take the address of addressable values (variables, struct fields, array/slice elements). Assign to a variable first.`,
	},
	{
		pattern: /cannot assign to (.+)/i,
		explain: m => `"${m[1].trim()}" is not assignable. Map values and some other expressions are not directly addressable in Go.`,
	},
	{
		pattern: /wrong number of values in assignment/i,
		explain: () => `The number of variables on the left side of := or = does not match the number of values on the right side.`,
	},
	{
		pattern: /(\S+) is not a type/i,
		explain: m => `"${m[1]}" is being used as a type but it is not one. Check whether you meant to use a variable or call a function.`,
	},
	{
		pattern: /syntax error: unexpected (.+)/i,
		explain: m => `Go syntax error — unexpected "${m[1]}". Check for missing brackets, commas, or keywords nearby.`,
	},
	{
		pattern: /non-boolean condition in if statement/i,
		explain: () => `The condition in an if statement must be a boolean. Go does not allow non-boolean conditions (unlike C/C++).`,
	},

	// ════════════════════════════════════════════════════════════════
	// GO — runtime panics
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /panic: runtime error: index out of range \[(\d+)\] with length (\d+)/i,
		explain: m => `You tried to access index ${m[1]} in a slice or array of length ${m[2]}. Valid indices are 0 to ${parseInt(m[2]) - 1}. Check the length before indexing.`,
	},
	{
		pattern: /panic: runtime error: invalid memory address or nil pointer dereference/i,
		explain: () => `You dereferenced a nil pointer. An interface, pointer, map, or channel is nil when you tried to use it. Check that the value is initialised before use.`,
	},
	{
		pattern: /panic: runtime error: slice bounds out of range/i,
		explain: () => `A slice operation has invalid bounds. The low bound, high bound, or capacity exceeds the slice's length. Check the indices you are using.`,
	},
	{
		pattern: /panic: runtime error: integer divide by zero/i,
		explain: () => `Integer division by zero. Add a check to make sure the divisor is not zero before dividing.`,
	},
	{
		pattern: /panic: interface conversion: interface is nil, not (.+)/i,
		explain: m => `An interface that is nil was asserted to type "${m[1]}". Check that the interface value is not nil before type-asserting.`,
	},
	{
		pattern: /panic: interface conversion: .+ is (.+), not (.+)/i,
		explain: m => `Type assertion failed: the interface holds a "${m[1]}" but you asserted it to "${m[2]}". Use the two-value form: val, ok := x.(Type) to check safely.`,
	},
	{
		pattern: /panic: send on closed channel/i,
		explain: () => `You sent a value on a channel that has already been closed. Only close a channel once, and only send on open channels.`,
	},
	{
		pattern: /panic: assignment to entry in nil map/i,
		explain: () => `You tried to insert into a map that is nil. Initialise the map first: m = make(map[KeyType]ValueType).`,
	},
	{
		pattern: /goroutine \d+ \[(\w+(?: \w+)*)\]:/i,
		explain: m => `A goroutine is in state "${m[1]}". This appears in stack traces during panics or deadlocks. Look at the frames below this line to find the source.`,
	},
	{
		pattern: /fatal error: all goroutines are asleep - deadlock!/i,
		explain: () => `All goroutines are blocked — this is a deadlock. A channel receive or mutex lock is waiting forever. Check that every send has a matching receive and every lock has an unlock.`,
	},

	]),

	..._lang('java', [
	// ════════════════════════════════════════════════════════════════
	// JAVA — runtime exceptions
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /NullPointerException/i,
		explain: () => `An object reference is null when you tried to use it. Check that all objects are initialised before calling methods or accessing fields on them.`,
	},
	{
		pattern: /ArrayIndexOutOfBoundsException: Index (\d+) out of bounds for length (\d+)/i,
		explain: m => `You tried to access index ${m[1]} in an array of length ${m[2]}. Valid indices are 0 to ${parseInt(m[2]) - 1}. Add a bounds check before accessing the array.`,
	},
	{
		pattern: /ArrayIndexOutOfBoundsException: (\d+)/i,
		explain: m => `Array index ${m[1]} is out of bounds. Check the array length before indexing into it.`,
	},
	{
		pattern: /StringIndexOutOfBoundsException: String index out of range: (\d+)/i,
		explain: m => `You tried to access character at index ${m[1]} in a string that is shorter. Check the string length before indexing.`,
	},
	{
		pattern: /ClassCastException: class (.+?) cannot be cast to class (.+)/i,
		explain: m => `A "${m[1]}" cannot be cast to "${m[2]}". Check the actual type of the object before casting, or use instanceof.`,
	},
	{
		pattern: /StackOverflowError/i,
		explain: () => `A method is calling itself recursively with no exit condition, exhausting the call stack. Add a base case to stop the recursion.`,
	},
	{
		pattern: /ClassNotFoundException: (.+)/i,
		explain: m => `The class "${m[1]}" could not be found. Make sure the dependency is on the classpath and the name is spelled correctly.`,
	},
	{
		pattern: /NumberFormatException: For input string: ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" cannot be parsed as a number. Check that the string contains only valid numeric characters before parsing.`,
	},
	{
		pattern: /IllegalArgumentException: (.+)/i,
		explain: m => `An illegal argument was passed to a method: ${m[1]}. Check the argument values match the method's requirements.`,
	},
	{
		pattern: /IllegalStateException: (.+)/i,
		explain: m => `The object is in an illegal state for this operation: ${m[1]}. Check that you are calling methods in the correct order.`,
	},
	{
		pattern: /UnsupportedOperationException/i,
		explain: () => `This operation is not supported. You may be calling a mutating method on an unmodifiable collection (e.g. List.of() or Collections.unmodifiableList()).`,
	},
	{
		pattern: /ConcurrentModificationException/i,
		explain: () => `A collection was modified while being iterated. Use an Iterator's own remove() method, or iterate over a copy of the collection.`,
	},
	{
		pattern: /ArithmeticException: \/ by zero/i,
		explain: () => `Integer division by zero. Add a check to ensure the divisor is not zero before dividing.`,
	},
	{
		pattern: /OutOfMemoryError: Java heap space/i,
		explain: () => `The JVM ran out of heap memory. Increase the heap size with -Xmx, or fix a memory leak. Use a profiler to find what is consuming memory.`,
	},
	{
		pattern: /OutOfMemoryError: GC overhead limit exceeded/i,
		explain: () => `The JVM is spending too much time in garbage collection without reclaiming much memory. This often indicates a memory leak or objects being held longer than needed.`,
	},
	{
		pattern: /NoSuchMethodException: (.+)/i,
		explain: m => `The method "${m[1]}" was not found. Check the method name, parameter types, and that the correct class is being reflected.`,
	},
	{
		pattern: /NoSuchFieldException: (.+)/i,
		explain: m => `The field "${m[1]}" was not found. Check the field name and that you are reflecting the correct class.`,
	},
	{
		pattern: /FileNotFoundException: (.+)/i,
		explain: m => `The file "${m[1]}" was not found. Check the path is correct relative to where the program is run from.`,
	},

	// ════════════════════════════════════════════════════════════════
	// JAVA — compiler errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error: cannot find symbol[\s\S]{0,100}symbol\s*:\s*(?:variable|method|class) (\S+)/i,
		explain: m => `The symbol "${m[1]}" cannot be found. Check the spelling and that it has been declared or imported.`,
	},
	{
		pattern: /error: incompatible types: (.+?) cannot be converted to (.+)/i,
		explain: m => `A "${m[1]}" cannot be automatically converted to "${m[2]}". Add an explicit cast or change the variable type.`,
	},
	{
		pattern: /error: variable (.+?) might not have been initialized/i,
		explain: m => `"${m[1]}" might not be initialised on all code paths. Assign a default value when declaring it.`,
	},
	{
		pattern: /error: reached end of file while parsing/i,
		explain: () => `A closing brace "}" is missing. Make sure every opening brace has a matching closing brace.`,
	},
	{
		pattern: /error: ';' expected/i,
		explain: () => `A semicolon is missing at the end of a statement.`,
	},
	{
		pattern: /error: class, interface, or enum expected/i,
		explain: () => `Java expected a class, interface, or enum declaration here. Check that all braces are balanced and there is no code outside a class.`,
	},
	{
		pattern: /error: (.+?) is not abstract and does not override abstract method (.+?) in (.+)/i,
		explain: m => `The class "${m[1]}" must implement the abstract method "${m[2]}" from "${m[3]}". Add an implementation for that method.`,
	},

	]),

	..._lang('c', [
	// ════════════════════════════════════════════════════════════════
	// C / C++ — GCC/Clang warnings
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /warning: using the result of an assignment as a condition without parentheses \[-Wparentheses\]/i,
		explain: () => `You wrote something like "if (x = value)" which assigns to x instead of comparing. Use "==" to compare: "if (x == value)". If you intentionally meant to assign and test the result, wrap in extra parentheses "if ((x = value))" to silence this warning.`,
	},
	{
		pattern: /warning: unused variable ['"](.+?)['"] \[-Wunused-variable\]/i,
		explain: m => `The variable "${m[1]}" is declared but never used. Remove it, or prefix it with an underscore to signal it is intentionally unused.`,
	},
	{
		pattern: /warning: unused parameter ['"](.+?)['"] \[-Wunused-parameter\]/i,
		explain: m => `The function parameter "${m[1]}" is never used inside the function. Remove it, cast to void, or prefix with _ to suppress the warning.`,
	},
	{
		pattern: /warning: unused function ['"](.+?)['"] \[-Wunused-function\]/i,
		explain: m => `The function "${m[1]}" is defined but never called. Remove it if it is not needed.`,
	},
	{
		pattern: /warning: control reaches end of non-void function \[-Wreturn-type\]/i,
		explain: () => `The function is declared to return a value but some code paths fall off the end without returning. Add a return statement at the end, or make sure all branches return.`,
	},
	{
		pattern: /warning: missing return statement \[-Wreturn-type\]/i,
		explain: () => `This function should return a value but has no return statement. Add a return statement.`,
	},
	{
		pattern: /warning: comparison of integer expressions of different signedness.*\[-Wsign-compare\]/i,
		explain: () => `You are comparing a signed integer with an unsigned integer. This can cause unexpected behaviour when the signed value is negative. Cast one of them to make the types match.`,
	},
	{
		pattern: /warning: format ['"]%(.+?)['"] expects argument of type ['"](.+?)['"], but argument (\d+) has type ['"](.+?)['"] \[-Wformat/i,
		explain: m => `printf format mismatch: "%" + "${m[1]}" expects a "${m[2]}" but argument ${m[3]} is "${m[4]}". Use the correct format specifier for the type.`,
	},
	{
		pattern: /warning: implicit fallthrough between switch labels \[-Wimplicit-fallthrough\]/i,
		explain: () => `A switch case falls through to the next case without a break. Add a "break;" statement at the end of the case, or add a "// fallthrough" comment if intentional.`,
	},
	{
		pattern: /warning: ['"](.+?)['"] is deprecated.*\[-Wdeprecated-declarations?\]/i,
		explain: m => `"${m[1]}" is deprecated. Check the documentation for the recommended replacement.`,
	},
	{
		pattern: /warning: null pointer dereference.*\[-Wnull-dereference\]/i,
		explain: () => `The analyser detected a potential null pointer dereference. Add a null check before using the pointer.`,
	},
	{
		pattern: /warning: conversion from ['"](.+?)['"] to ['"](.+?)['"] may (?:lose|change) (?:data|sign|value).*\[-Wconversion/i,
		explain: m => `Implicit conversion from "${m[1]}" to "${m[2]}" may lose data or change the sign. Add an explicit cast if this is intentional.`,
	},
	{
		pattern: /warning: ['"](.+?)['"] is used uninitialized.*\[-Wuninitialized\]/i,
		explain: m => `"${m[1]}" is used before it has been given a value. Initialise it at the point of declaration.`,
	},
	{
		pattern: /warning: ['"](.+?)['"] may be used uninitialized.*\[-Wmaybe-uninitialized\]/i,
		explain: m => `"${m[1]}" may be used without being initialised on some code paths. Assign a default value when declaring it.`,
	},
	{
		pattern: /warning: declaration of ['"](.+?)['"] shadows.*\[-Wshadow\]/i,
		explain: m => `The variable "${m[1]}" shadows another variable with the same name in an outer scope. Rename one of them to avoid confusion.`,
	},
	{
		pattern: /warning: enumeration value ['"](.+?)['"] not handled in switch \[-Wswitch\]/i,
		explain: m => `The enum value "${m[1]}" has no case in this switch statement. Add a case for it or a default case.`,
	},
	{
		pattern: /warning: comparison is always (true|false) due to limited range of data type \[-Wtype-limits\]/i,
		explain: m => `This comparison is always ${m[1]} because of the data type's range. For example, comparing an unsigned value with < 0 is always false.`,
	},
	{
		pattern: /warning: left shift count >= width of type \[-Wshift-count-overflow\]/i,
		explain: () => `You are shifting a value by more bits than the type has. The result is undefined behaviour in C/C++. Use a wider type or reduce the shift amount.`,
	},
	{
		pattern: /warning: implicit declaration of function ['"](.+?)['"].*\[-Wimplicit-function-declaration\]/i,
		explain: m => `The function "${m[1]}" is called without being declared first. This is an error in C99+. Add the appropriate #include or declare the function prototype.`,
	},
	{
		pattern: /warning: ignoring return value of ['"](.+?)['"]/i,
		explain: m => `The return value of "${m[1]}" is being ignored. If the return value indicates success or failure, check it and handle errors.`,
	},
	{
		pattern: /warning: suggest parentheses around (.+?) in (.+?) \[-Wparentheses\]/i,
		explain: m => `The operator precedence of "${m[1]}" in "${m[2]}" may not be what you expect. Add parentheses to make the intended order explicit.`,
	},
	{
		pattern: /warning: address of local variable ['"](.+?)['"] returned/i,
		explain: m => `You are returning the address of the local variable "${m[1]}" which will be destroyed when the function returns. Return a heap-allocated value or use a static variable.`,
	},
	{
		pattern: /warning: unused variable \[-Wunused-variable\]/i,
		explain: () => `A variable is declared but never used. Remove it if it is not needed.`,
	},
	{
		pattern: /warning: array subscript (\d+) is above array bounds/i,
		explain: m => `Array access at index ${m[1]} is beyond the end of the array. Check the array size and the index being used.`,
	},
	{
		pattern: /warning: ('\\0' |zero) used as null pointer constant/i,
		explain: () => `Use NULL or nullptr instead of 0 or '\\0' as a null pointer constant. It is clearer and safer.`,
	},

	// ════════════════════════════════════════════════════════════════
	// C / C++ — compiler errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error: ['"](.+?)['"] was not declared in this scope/i,
		explain: m => `"${m[1]}" has not been declared. Check the spelling, the include files, and the namespace.`,
	},
	{
		pattern: /error: use of undeclared identifier ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" has not been declared. Check spelling and that the appropriate header is included.`,
	},
	{
		pattern: /error: expected ['"](.+?)['"] before ['"](.+?)['"]/i,
		explain: m => `The compiler expected "${m[1]}" but found "${m[2]}". Check the syntax around this line for a missing ${m[1]}.`,
	},
	{
		pattern: /error: expected ';' after namespace name/i,
		explain: () => `A semicolon was written after the namespace name, but namespaces do not use semicolons there. Change "namespace MyName;" to "namespace MyName { ... }".`,
	},
	{
		pattern: /error: a type specifier is required for all declarations/i,
		explain: () => `Every declaration needs a type. You may have written a statement or expression outside of a function, or forgotten the return type on a function definition.`,
	},
	{
		pattern: /error: expected ';' at end of declaration/i,
		explain: () => `A semicolon is missing at the end of a declaration. Add a semicolon after the closing brace or value — this is common after struct, class, or enum definitions.`,
	},
	{
		pattern: /error: expected ['"](.+?)['"] at end of input/i,
		explain: m => `The file ended before a "${m[1]}" was found. A "${m[1]}" is missing, likely a closing brace or parenthesis.`,
	},
	{
		pattern: /error: expected primary-expression before ['"](.+?)['"]/i,
		explain: m => `The compiler expected an expression but found "${m[1]}". Check for a missing operand, or a misplaced keyword.`,
	},
	{
		pattern: /error: redeclaration of ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is declared more than once. Remove the duplicate declaration or wrap headers in include guards.`,
	},
	{
		pattern: /error: ['"](.+?)['"] redeclared as different kind of symbol/i,
		explain: m => `"${m[1]}" was previously declared as one kind of thing (e.g. a variable) and is now being declared as another (e.g. a function). Rename one of them.`,
	},
	{
		pattern: /error: conflicting types for ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is declared with conflicting types in different places. Make the declarations consistent.`,
	},
	{
		pattern: /error: too many arguments to function ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is being called with more arguments than its declaration accepts. Check the function prototype.`,
	},
	{
		pattern: /error: too few arguments to function ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is being called with fewer arguments than its declaration requires. Provide all required arguments.`,
	},
	{
		pattern: /error: request for member ['"](.+?)['"] in ['"](.+?)['"], which is of non-class type/i,
		explain: m => `"${m[2]}" is not a struct or class, so it has no member "${m[1]}". Check that the variable is of the correct type.`,
	},
	{
		pattern: /error: lvalue required as left operand of assignment/i,
		explain: () => `The left side of the assignment is not a valid target. You cannot assign to a literal, a function call result, or a temporary. Check the left-hand side of the = operator.`,
	},
	{
		pattern: /error: subscripted value is neither array nor pointer nor vector/i,
		explain: () => `You are using square bracket indexing on a value that is not an array, pointer, or vector. Check the type of the variable you are indexing.`,
	},
	{
		pattern: /error: called object ['"](.+?)['"] is not a function or function pointer/i,
		explain: m => `"${m[1]}" is not a function or function pointer but is being called with (). Check that you are calling the right thing.`,
	},
	{
		pattern: /error: no match for operator (.+?) \(operand types are ['"](.+?)['"] and ['"](.+?)['"]\)/i,
		explain: m => `The operator "${m[1]}" is not defined for types "${m[2]}" and "${m[3]}". You may need to implement or overload this operator, or use compatible types.`,
	},
	{
		pattern: /error: no matching function for call to ['"](.+?)['"]/i,
		explain: m => `No overload of "${m[1]}" matches the argument types you provided. Check the function signature and the types of the arguments.`,
	},
	{
		pattern: /error: conversion from ['"](.+?)['"] to non-scalar type ['"](.+?)['"] requested/i,
		explain: m => `Cannot implicitly convert "${m[1]}" to "${m[2]}". Add an explicit constructor call or cast.`,
	},
	{
		pattern: /error: invalid conversion from ['"](.+?)['"] to ['"](.+?)['"]/i,
		explain: m => `Cannot convert "${m[1]}" to "${m[2]}". Add an explicit cast or change the types to be compatible.`,
	},
	{
		pattern: /error: incomplete type ['"](.+?)['"] used in nested name specifier/i,
		explain: m => `The type "${m[1]}" is incomplete — it was forward-declared but the full definition has not been seen yet. Include the header that defines it.`,
	},

	// ════════════════════════════════════════════════════════════════
	// C / C++ — linker errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /undefined reference to ['"`]?(.+?)['"`]?\s*$/im,
		explain: m => `"${m[1].trim()}" is declared but has no definition. Make sure the implementation file is compiled and linked, and the function body exists.`,
	},
	{
		pattern: /multiple definition of ['"`]?(.+?)['"`]?/im,
		explain: m => `"${m[1].trim()}" is defined in more than one translation unit. Move the definition to a .c/.cpp file and keep only a declaration in the header.`,
	},
	{
		pattern: /ld: symbol\(s\) not found for architecture/i,
		explain: () => `The linker could not find one or more symbols. A required library or object file is missing from the link command. Check that all source files are compiled and all -l flags are present.`,
	},

	// ════════════════════════════════════════════════════════════════
	// C / C++ — runtime errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /[Ss]egmentation fault(?: \(core dumped\))?/i,
		explain: () => `A segmentation fault means the program accessed memory it is not allowed to. Common causes: null or dangling pointer dereference, buffer overflow, or use-after-free. Run under a debugger or valgrind to find the exact location.`,
	},
	{
		pattern: /[Bb]us error(?: \(core dumped\))?/i,
		explain: () => `A bus error means the program tried to access memory with an invalid alignment. This often happens when dereferencing a misaligned pointer.`,
	},
	{
		pattern: /[Ff]loating point exception(?: \(core dumped\))?/i,
		explain: () => `A floating point exception usually means integer division by zero (SIGFPE). Check all division operations to make sure the divisor is not zero.`,
	},
	{
		pattern: /[Ii]llegal instruction(?: \(core dumped\))?/i,
		explain: () => `The CPU executed an illegal instruction. This can happen when a null function pointer is called, when memory is corrupted, or when a binary built for a different CPU architecture is run.`,
	},
	{
		pattern: /\*\*\* stack smashing detected \*\*\*/i,
		explain: () => `Stack smashing means a buffer overflow overwrote the stack canary value. A local array was written beyond its bounds. Check all array writes and string copies.`,
	},
	{
		pattern: /double free or corruption/i,
		explain: () => `Memory is being freed more than once, or the heap metadata has been corrupted. Make sure each allocated block is freed exactly once.`,
	},
	{
		pattern: /free\(\): invalid pointer/i,
		explain: () => `free() was called with a pointer that was not returned by malloc/calloc/realloc. Do not modify or offset heap pointers before freeing them.`,
	},
	{
		pattern: /Abort trap: 6|Aborted \(core dumped\)/i,
		explain: () => `The program called abort() or assert() failed. An assertion inside the program or a library detected an inconsistency.`,
	},
	{
		pattern: /error: implicit declaration of function ['"](.+?)['"] \[-Wimplicit-function-declaration\]|error: implicit declaration of function ['"](.+?)['"]/i,
		explain: m => `The function "${m[1] || m[2]}" is called without being declared first. Add the appropriate #include or write a prototype before the call.`,
	},

	]),

	..._lang('rust', [
	// ════════════════════════════════════════════════════════════════
	// RUST — borrow checker
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error\[E0382\]: (?:borrow of|use of) moved value: ['"`](.+?)['"`]/i,
		explain: m => `"${m[1]}" has already been moved and cannot be used again. Either clone the value before the move, or restructure the code to avoid the move.`,
	},
	{
		pattern: /error\[E0499\]: cannot borrow ['"`](.+?)['"`] as mutable more than once at a time/i,
		explain: m => `"${m[1]}" is already mutably borrowed elsewhere. Rust enforces exclusive mutable access. End the first borrow before starting the second.`,
	},
	{
		pattern: /error\[E0502\]: cannot borrow ['"`](.+?)['"`] as (?:immutable|mutable) because it is also borrowed as (?:mutable|immutable)/i,
		explain: m => `"${m[1]}" cannot be borrowed as both mutable and immutable at the same time. Restructure the code so the borrows do not overlap.`,
	},
	{
		pattern: /error\[E0505\]: cannot move out of ['"`](.+?)['"`] because it is borrowed/i,
		explain: m => `"${m[1]}" cannot be moved while it is borrowed. End the borrow before moving, or clone the value.`,
	},
	{
		pattern: /error\[E0596\]: cannot borrow ['"`](.+?)['"`] as mutable, as it is not declared as mutable/i,
		explain: m => `"${m[1]}" needs to be declared as mutable to borrow it mutably. Change the declaration to: let mut ${m[1]} = ...`,
	},
	{
		pattern: /error\[E0597\]: ['"`](.+?)['"`] does not live long enough/i,
		explain: m => `"${m[1]}" is dropped before a reference to it is used. Extend the lifetime of the value so it outlives all references to it.`,
	},
	{
		pattern: /error\[E0507\]: cannot move out of .+ which is behind a (?:shared|mutable) reference/i,
		explain: () => `You cannot move a value out of a reference. Use .clone() to get an owned copy, or restructure to avoid the move.`,
	},

	// ════════════════════════════════════════════════════════════════
	// RUST — type / trait errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error\[E0308\]: mismatched types/i,
		explain: () => `The type of a value does not match what is expected. Check the function signature and the types of the values you are providing.`,
	},
	{
		pattern: /error\[E0277\]: the trait bound ['"`](.+?)['"`] is not satisfied/i,
		explain: m => `The type "${m[1]}" does not implement the required trait. Derive or implement the trait for the type.`,
	},
	{
		pattern: /error\[E0369\]: binary operation ['"`](.+?)['"`] cannot be applied to type ['"`](.+?)['"`]/i,
		explain: m => `The operator "${m[1]}" is not implemented for type "${m[2]}". Implement the corresponding std::ops trait for your type.`,
	},
	{
		pattern: /error\[E0412\]: cannot find type ['"`](.+?)['"`] in this scope/i,
		explain: m => `The type "${m[1]}" is not in scope. Check the spelling or add the appropriate use statement.`,
	},
	{
		pattern: /error\[E0425\]: cannot find (?:value|function|macro) ['"`](.+?)['"`] in this scope/i,
		explain: m => `"${m[1]}" is not in scope. Check the spelling and that it has been imported with "use" or declared.`,
	},
	{
		pattern: /error\[E0428\]: the name ['"`](.+?)['"`] is defined multiple times/i,
		explain: m => `"${m[1]}" is defined more than once in the same scope. Rename one of them.`,
	},
	{
		pattern: /error\[E0106\]: missing lifetime specifier/i,
		explain: () => `A reference in this function signature needs a lifetime annotation. Add explicit lifetime parameters, e.g. fn foo<'a>(x: &'a str).`,
	},
	{
		pattern: /error\[E0433\]: failed to resolve: use of undeclared (?:crate or module|type or module) ['"`](.+?)['"`]/i,
		explain: m => `"${m[1]}" is not found. Check the module path and make sure the crate is listed in Cargo.toml.`,
	},
	{
		pattern: /error\[E0560\]: struct ['"`](.+?)['"`] has no field named ['"`](.+?)['"`]/i,
		explain: m => `The struct "${m[1]}" does not have a field named "${m[2]}". Check the spelling or the struct definition.`,
	},

	// ════════════════════════════════════════════════════════════════
	// RUST — Cargo / build
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error: no such file or directory: ['"]src\/main\.rs['"]/i,
		explain: () => `Cargo cannot find "src/main.rs". Make sure the file exists, or set the binary entry point in Cargo.toml under [[bin]].`,
	},
	{
		pattern: /error: package ['"](.+?)['"] not found in the registry/i,
		explain: m => `The crate "${m[1]}" was not found. Check the crate name on crates.io and that it is spelled correctly in Cargo.toml.`,
	},
	{
		pattern: /warning: unused (?:variable|import): ['"`](.+?)['"`]/i,
		explain: m => `"${m[1]}" is declared or imported but never used. Remove it or prefix the name with "_" to silence the warning.`,
	},

	]),

	..._lang('ruby', [
	// ════════════════════════════════════════════════════════════════
	// RUBY
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /NoMethodError: undefined method ['"](.+?)['"] for (.+)/i,
		explain: m => `The method "${m[1]}" does not exist on ${m[2]}. Check the spelling and the object's class.`,
	},
	{
		pattern: /NameError: undefined local variable or method ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is not defined. Check the spelling and that it has been defined before use.`,
	},
	{
		pattern: /TypeError: no implicit conversion of (.+?) into (.+)/i,
		explain: m => `Ruby cannot automatically convert a ${m[1]} to a ${m[2]}. Use an explicit conversion method like .to_s, .to_i, or .to_a.`,
	},
	{
		pattern: /ArgumentError: wrong number of arguments \(given (\d+), expected (\d+)\)/i,
		explain: m => `The method was called with ${m[1]} argument(s) but expects ${m[2]}. Check the method signature.`,
	},
	{
		pattern: /ZeroDivisionError: divided by 0/i,
		explain: () => `Division by zero. Add a check to make sure the divisor is not zero before dividing.`,
	},
	{
		pattern: /IndexError: index (\d+) outside of array bounds: (-?\d+)\.\.\.(\d+)/i,
		explain: m => `Array index ${m[1]} is out of bounds (${m[2]}...${m[3]}). Check the array length before indexing.`,
	},
	{
		pattern: /KeyError: key not found: (.+)/i,
		explain: m => `The key ${m[1]} does not exist in the hash. Use .fetch with a default or check with .key? before accessing.`,
	},
	{
		pattern: /LoadError: cannot load such file -- (.+)/i,
		explain: m => `The file or gem "${m[1]}" could not be loaded. Check the require path or run "gem install ${m[1]}" if it is a gem.`,
	},
	{
		pattern: /Errno::ENOENT: No such file or directory @ (?:rb_sysopen - )?(.+)/i,
		explain: m => `The file "${m[1]}" does not exist. Check the path for typos.`,
	},
	{
		pattern: /SyntaxError: (.+): syntax error, unexpected (.+)/i,
		explain: m => `Ruby syntax error at "${m[1]}": unexpected "${m[2]}". Check for missing "end", "do", or punctuation.`,
	},
	{
		pattern: /RuntimeError: (.+)/i,
		explain: m => `A runtime error was raised: "${m[1]}". Check the logic that triggers this condition.`,
	},
	{
		pattern: /NotImplementedError/i,
		explain: () => `This method has not been implemented. If you are subclassing, you must implement this method in the subclass.`,
	},
	{
		pattern: /RangeError: (.+) out of range/i,
		explain: m => `A value "${m[1]}" is out of the valid range. Check the bounds of the operation.`,
	},
	{
		pattern: /Encoding::UndefinedConversionError/i,
		explain: () => `A character could not be converted between encodings. Check the encoding of your strings and use String#encode with a :fallback option.`,
	},
	{
		pattern: /IOError: closed stream/i,
		explain: () => `You are reading or writing to an IO stream that has already been closed. Make sure to perform all operations before closing the stream.`,
	},
	{
		pattern: /RegexpError: (.+)/i,
		explain: m => `The regular expression is invalid: ${m[1]}. Check the regex syntax.`,
	},
	{
		pattern: /Errno::EACCES: Permission denied @ (?:rb_sysopen - )?(.+)/i,
		explain: m => `Permission denied for "${m[1]}". Check the file permissions.`,
	},
	{
		pattern: /SystemStackError: stack level too deep/i,
		explain: () => `Ruby's call stack overflowed due to infinite recursion. Add a base case to your recursive method.`,
	},

	]),

	..._lang('php', [
	// ════════════════════════════════════════════════════════════════
	// PHP
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /Fatal error: Uncaught TypeError: (.+?) Argument #(\d+) \((.+?)\) must be of type (.+?), (.+?) given/i,
		explain: m => `Argument #${m[2]} (${m[3]}) passed to ${m[1]} must be of type ${m[4]}, but ${m[5]} was given. Check the type of the argument.`,
	},
	{
		pattern: /Fatal error: Call to undefined function (.+?)\(\)/i,
		explain: m => `The function "${m[1]}()" is not defined. Check for typos or a missing include/require.`,
	},
	{
		pattern: /Fatal error: Call to undefined method (.+?)::(.+?)\(\)/i,
		explain: m => `The method "${m[2]}()" does not exist on class "${m[1]}". Check the spelling and the class definition.`,
	},
	{
		pattern: /Fatal error: Uncaught Error: Call to a member function (.+?)\(\) on null/i,
		explain: m => `You are calling "${m[1]}()" on a null value. The object was not created or a function returned null. Add a null check.`,
	},
	{
		pattern: /Warning: Undefined variable \$(\S+)/i,
		explain: m => `The variable "\$${m[1]}" is used but has not been defined. Check the spelling and make sure it is assigned before use.`,
	},
	{
		pattern: /Warning: Undefined array key (\S+)/i,
		explain: m => `The array key ${m[1]} does not exist. Use isset() or array_key_exists() before accessing it.`,
	},
	{
		pattern: /Warning: Division by zero/i,
		explain: () => `Division by zero. Add a check to ensure the divisor is not zero.`,
	},
	{
		pattern: /Parse error: syntax error, unexpected token ['"](.+?)['"]/i,
		explain: m => `PHP syntax error near "${m[1]}". Check for missing semicolons, brackets, or mismatched quotes.`,
	},
	{
		pattern: /Fatal error: Class ['"](.+?)['"] not found/i,
		explain: m => `The class "${m[1]}" could not be found. Check the namespace, use statement, or autoloader configuration.`,
	},
	{
		pattern: /Warning: include\(\): Failed opening ['"](.+?)['"]/i,
		explain: m => `include() could not open "${m[1]}". Check the file path and that the file exists.`,
	},
	{
		pattern: /Warning: require\(\): Failed opening ['"](.+?)['"]/i,
		explain: m => `require() could not open "${m[1]}". Check the file path and that the file exists.`,
	},
	{
		pattern: /Notice: Array to string conversion/i,
		explain: () => `You are trying to use an array as a string. Convert it first with implode() or json_encode().`,
	},
	{
		pattern: /Warning: Cannot modify header information - headers already sent/i,
		explain: () => `Output (HTML or whitespace) was sent before a header() call. Make sure no output is printed before calling header(). Check for whitespace before the opening <?php tag.`,
	},
	{
		pattern: /Fatal error: Allowed memory size of .+ bytes exhausted/i,
		explain: () => `PHP ran out of memory. Increase memory_limit in php.ini, or fix a memory leak — for example, large loops that keep growing arrays.`,
	},
	{
		pattern: /Fatal error: Maximum execution time of (\d+) second/i,
		explain: m => `The script exceeded the ${m[1]}-second execution time limit. Optimise the slow operation or increase max_execution_time in php.ini.`,
	},
	{
		pattern: /Warning: file_get_contents\((.+?)\): [Ff]ailed to open stream/i,
		explain: m => `file_get_contents() could not open "${m[1]}". Check the path or URL is correct and accessible.`,
	},
	{
		pattern: /Warning: preg_match\(\): Unknown modifier ['"](.+?)['"]/i,
		explain: m => `The regex has an unknown modifier "${m[1]}". PCRE modifiers are single letters like i, m, s, u. Check the regex delimiter and flags.`,
	},
	{
		pattern: /Fatal error: Uncaught Error: Class ['"](.+?)['"] not found/i,
		explain: m => `The class "${m[1]}" is not available. Add a use statement, check the autoloader, or require the file that defines it.`,
	},
	{
		pattern: /Notice: Trying to access array offset on value of type null/i,
		explain: () => `You are indexing into a null value as if it were an array. Check that the variable has been initialised and holds an array.`,
	},
	{
		pattern: /TypeError: (.+?) must be of type (.+?), (.+?) given/i,
		explain: m => `${m[1]} expected type ${m[2]} but received ${m[3]}. Check the types of your arguments or return values.`,
	},

	]),

	..._lang('csharp', [
	// ════════════════════════════════════════════════════════════════
	// C# — compiler errors
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error CS0103: The name ['"](.+?)['"] does not exist in the current context/i,
		explain: m => `"${m[1]}" is not defined in this scope. Check the spelling and that the variable or type has been declared.`,
	},
	{
		pattern: /error CS0117: ['"](.+?)['"] does not contain a definition for ['"](.+?)['"]/i,
		explain: m => `The type "${m[1]}" does not have a member called "${m[2]}". Check the spelling or the type definition.`,
	},
	{
		pattern: /error CS0161: ['"](.+?)['"].*not all code paths return a value/i,
		explain: m => `"${m[1]}" does not return a value on all code paths. Make sure every branch returns something or throws.`,
	},
	{
		pattern: /error CS0246: The type or namespace name ['"](.+?)['"] could not be found/i,
		explain: m => `The type "${m[1]}" could not be found. Add the appropriate using directive or check the NuGet package.`,
	},
	{
		pattern: /error CS0266: Cannot implicitly convert type ['"](.+?)['"] to ['"](.+?)['"]/i,
		explain: m => `Cannot implicitly convert "${m[1]}" to "${m[2]}". Add an explicit cast: (${m[2]}) value.`,
	},
	{
		pattern: /error CS1002: ; expected/i,
		explain: () => `A semicolon is missing at the end of a statement.`,
	},
	{
		pattern: /error CS1513: \} expected/i,
		explain: () => `A closing brace "}" is missing. Check that all opened braces are closed.`,
	},
	{
		pattern: /error CS0029: Cannot implicitly convert type ['"](.+?)['"] to ['"](.+?)['"]/i,
		explain: m => `Cannot implicitly convert "${m[1]}" to "${m[2]}". Add an explicit cast or change the variable type.`,
	},
	{
		pattern: /error CS0128: A local variable or function named ['"](.+?)['"] is already defined/i,
		explain: m => `"${m[1]}" has already been declared in this scope. Rename one of the variables.`,
	},
	{
		pattern: /error CS0165: Use of unassigned local variable ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is used before it is assigned. Give it an initial value when declaring it.`,
	},
	{
		pattern: /error CS0019: Operator ['"](.+?)['"] cannot be applied to operands of type ['"](.+?)['"] and ['"](.+?)['"]/i,
		explain: m => `The operator "${m[1]}" cannot be used between "${m[2]}" and "${m[3]}". Check that the types are compatible or implement the operator.`,
	},

	// ════════════════════════════════════════════════════════════════
	// C# — runtime exceptions
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /System\.NullReferenceException/i,
		explain: () => `A NullReferenceException means you tried to use an object reference that is null. Check that all objects are initialised before accessing their members.`,
	},
	{
		pattern: /System\.IndexOutOfRangeException/i,
		explain: () => `An array or list was accessed at an index outside its bounds. Check the array length before indexing.`,
	},
	{
		pattern: /System\.InvalidCastException: Unable to cast object of type ['"](.+?)['"] to type ['"](.+?)['"]/i,
		explain: m => `Cannot cast a "${m[1]}" to "${m[2]}". Use the "as" keyword to get null on failure, or "is" to check the type first.`,
	},
	{
		pattern: /System\.DivideByZeroException/i,
		explain: () => `Integer division by zero. Add a check to make sure the divisor is not zero before dividing.`,
	},
	{
		pattern: /System\.StackOverflowException/i,
		explain: () => `The call stack overflowed due to infinite recursion. Add a base case to stop the recursion.`,
	},
	{
		pattern: /System\.OutOfMemoryException/i,
		explain: () => `The process ran out of memory. Check for memory leaks or large allocations, or increase the available memory.`,
	},
	{
		pattern: /System\.IO\.FileNotFoundException: Could not find file ['"](.+?)['"]/i,
		explain: m => `The file "${m[1]}" was not found. Check the path is correct relative to the working directory.`,
	},
	{
		pattern: /System\.ArgumentNullException: Value cannot be null/i,
		explain: () => `A null argument was passed where a non-null value is required. Check what you are passing to the method.`,
	},
	{
		pattern: /System\.Collections\.Generic\.KeyNotFoundException/i,
		explain: () => `A dictionary key was not found. Use TryGetValue() or ContainsKey() before accessing the dictionary.`,
	},
	{
		pattern: /System\.InvalidOperationException: (.+)/i,
		explain: m => `The object is in an invalid state for this operation: ${m[1]}. Check that you are calling methods in the correct order.`,
	},
	{
		pattern: /System\.NotImplementedException/i,
		explain: () => `This method has not been implemented. If this is intentional, add a TODO comment. Otherwise implement the method.`,
	},
	{
		pattern: /System\.FormatException: Input string was not in a correct format/i,
		explain: () => `A string could not be parsed into the expected type. The string may contain non-numeric characters or an unexpected format. Use TryParse() to avoid exceptions.`,
	},
	{
		pattern: /System\.OverflowException/i,
		explain: () => `A numeric operation produced a result outside the range of the type. Use a larger type like long, or use the checked/unchecked keyword explicitly.`,
	},

	]),

	..._lang('bash', [
	// ════════════════════════════════════════════════════════════════
	// BASH / SHELL
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /(?:bash|sh|zsh): (\S+): command not found/i,
		explain: m => `The command "${m[1]}" is not installed or not in PATH. Install it with your package manager, or check the PATH environment variable.`,
	},
	{
		pattern: /(?:bash|sh|zsh): (\S+): No such file or directory/i,
		explain: m => `"${m[1]}" does not exist. Check the path for typos.`,
	},
	{
		pattern: /(?:bash|sh|zsh): (\S+): Permission denied/i,
		explain: m => `You do not have permission to execute "${m[1]}". Run "chmod +x ${m[1]}" to make it executable.`,
	},
	{
		pattern: /syntax error near unexpected token ['"](.+?)['"]/i,
		explain: m => `Bash syntax error near "${m[1]}". Check for unmatched parentheses, quotes, or an extra ")" at this point.`,
	},
	{
		pattern: /syntax error: unexpected end of file/i,
		explain: () => `The script ended unexpectedly. A "fi", "done", "esac", or closing "}" is probably missing.`,
	},
	{
		pattern: /bad substitution/i,
		explain: () => `An invalid parameter expansion was used. Check the syntax of the \${...} expression — a brace or operator may be wrong.`,
	},
	{
		pattern: /(?:bash|sh): (\S+): unbound variable/i,
		explain: m => `The variable "${m[1]}" is unset but the script requires all variables to be set (set -u). Assign a value to "${m[1]}" or use \${${m[1]}:-default}.`,
	},
	{
		pattern: /ambiguous redirect/i,
		explain: () => `A redirect is ambiguous, usually because a variable used in the redirect is unset or expands to multiple words. Quote the variable: > "$file".`,
	},
	{
		pattern: /\[: (.+?): integer expression expected/i,
		explain: m => `The value "${m[1]}" is not an integer. [ ] arithmetic tests require integers. Check the variable contains a number.`,
	},
	{
		pattern: /cannot create (.+?): File exists/i,
		explain: m => `"${m[1]}" already exists. Check if you need to remove or overwrite it first.`,
	},
	{
		pattern: /Argument list too long/i,
		explain: () => `The shell expanded too many arguments. Use xargs or a loop to process the files in batches.`,
	},
	{
		pattern: /cannot execute binary file: Exec format error/i,
		explain: () => `The binary was compiled for a different CPU architecture. Make sure you are using the correct version for your platform.`,
	},
	{
		pattern: /line (\d+): (.+?): (?:command not found|not found)/i,
		explain: m => `Line ${m[1]}: the command "${m[2]}" was not found. Check the spelling and that it is installed and in PATH.`,
	},
	{
		pattern: /(?:declare|local): (.+?): not found/i,
		explain: m => `The variable or option "${m[1]}" is not valid here. Check the syntax of the declare or local command.`,
	},

	]),

	..._lang('kotlin', [
	// ════════════════════════════════════════════════════════════════
	// KOTLIN
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error: unresolved reference: (\S+)/i,
		explain: m => `"${m[1]}" is not defined in this scope. Check the spelling and add the necessary import.`,
	},
	{
		pattern: /error: type mismatch: inferred type is (.+?) but (.+?) was expected/i,
		explain: m => `The inferred type is "${m[1]}" but "${m[2]}" was expected. Check the types and add an explicit cast or conversion if needed.`,
	},
	{
		pattern: /error: val cannot be reassigned/i,
		explain: () => `A "val" is immutable and cannot be reassigned. Change it to "var" if you need to reassign it.`,
	},
	{
		pattern: /error: a 'return' expression required in a function with a block body/i,
		explain: () => `This function must explicitly return a value. Add a return statement, or use = for expression body syntax.`,
	},
	{
		pattern: /error: none of the following candidates is applicable because of receiver type mismatch/i,
		explain: () => `No matching function or extension function was found for this receiver type. Check the type of the object and the function signature.`,
	},
	{
		pattern: /error: overload resolution ambiguity/i,
		explain: () => `Multiple functions match the call and Kotlin cannot pick one. Add an explicit type or cast to disambiguate.`,
	},
	{
		pattern: /error: variable ['"](.+?)['"] must be initialized/i,
		explain: m => `"${m[1]}" is declared but not initialised. Assign a value at the declaration site or mark it as lateinit.`,
	},
	{
		pattern: /error: smart cast to ['"](.+?)['"] is impossible/i,
		explain: m => `Kotlin cannot smart-cast to "${m[1]}" because the value could have been changed by another thread or branch. Store it in a local val first.`,
	},
	{
		pattern: /error: function declaration must have a name/i,
		explain: () => `A function keyword is present but the function name is missing. Add a name after the "fun" keyword.`,
	},
	{
		pattern: /error: property must be initialized or be abstract/i,
		explain: () => `A property in a class must have an initial value or be declared abstract. Add an initialiser or mark the class as abstract.`,
	},
	{
		pattern: /kotlin\.KotlinNullPointerException|NullPointerException/i,
		explain: () => `A null value was dereferenced. Use the ?. operator for safe calls, or !! only when you are certain the value is not null.`,
	},
	{
		pattern: /error: expecting ['"](.+?)['"]/i,
		explain: m => `Kotlin expected "${m[1]}" here but found something else. Check the syntax around this line.`,
	},
	{
		pattern: /error: none of the following functions can be called with the arguments supplied/i,
		explain: () => `No function overload matches the argument types you provided. Check the argument types against the function signatures.`,
	},

	]),

	..._lang('swift', [
	// ════════════════════════════════════════════════════════════════
	// SWIFT
	// ════════════════════════════════════════════════════════════════
	{
		pattern: /error: use of unresolved identifier ['"](.+?)['"]/i,
		explain: m => `"${m[1]}" is not defined. Check the spelling and that it has been declared in scope.`,
	},
	{
		pattern: /error: cannot convert value of type ['"](.+?)['"] to specified type ['"](.+?)['"]/i,
		explain: m => `A value of type "${m[1]}" cannot be used where "${m[2]}" is expected. Add an explicit conversion or cast.`,
	},
	{
		pattern: /error: value of type ['"](.+?)['"] has no member ['"](.+?)['"]/i,
		explain: m => `The type "${m[1]}" does not have a member called "${m[2]}". Check the spelling or the type definition.`,
	},
	{
		pattern: /error: cannot assign to value: ['"](.+?)['"] is a ['"]let['"] constant/i,
		explain: m => `"${m[1]}" is a constant (let) and cannot be reassigned. Change it to "var" if you need to modify it.`,
	},
	{
		pattern: /error: variable ['"](.+?)['"] used before being initialized/i,
		explain: m => `"${m[1]}" is used before it is given a value. Initialise it before use.`,
	},
	{
		pattern: /error: missing return in a function expected to return ['"](.+?)['"]/i,
		explain: m => `The function is expected to return "${m[1]}" but some code paths do not return a value. Make sure all branches return a value.`,
	},
	{
		pattern: /Fatal error: Index out of range/i,
		explain: () => `You accessed an array at an index that does not exist. Check the array count before indexing.`,
	},
	{
		pattern: /Fatal error: Unexpectedly found nil while (?:unwrapping an Optional value|implicitly unwrapping an Optional)/i,
		explain: () => `An Optional value was nil when it was forcibly unwrapped with "!". Use optional binding (if let) or nil coalescing (??) instead of force-unwrapping.`,
	},
	{
		pattern: /error: cannot call value of non-function type ['"](.+?)['"]/i,
		explain: m => `You are calling "${m[1]}" as a function but it is not a function. Check whether you accidentally overwrote a function with a property of the same name.`,
	},
	{
		pattern: /error: extra argument ['"](.+?)['"] in call/i,
		explain: m => `The function was called with an extra argument "${m[1]}" that it does not accept. Check the function signature.`,
	},
	{
		pattern: /error: missing argument for parameter ['"](.+?)['"] in call/i,
		explain: m => `The required argument "${m[1]}" was not provided in the function call. Check the function signature and supply all required parameters.`,
	},
	{
		pattern: /EXC_BAD_ACCESS/i,
		explain: () => `EXC_BAD_ACCESS means the process tried to access memory it is not allowed to. Common causes: dangling pointer, force-unwrapping a nil optional, or use-after-free.`,
	},
	{
		pattern: /error: expression is ambiguous without more context/i,
		explain: () => `Swift cannot infer the type from the expression alone. Add an explicit type annotation to help the compiler.`,
	},
	{
		pattern: /error: immutable value ['"](.+?)['"] may only be initialized once/i,
		explain: m => `"${m[1]}" is a let constant and can only be assigned once. If you need to set it conditionally, use a temporary var and assign to let at the end.`,
	},
	]),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractLineNumber(text: string): number | null {
	const patterns = [
		/(?:[A-Za-z0-9._/ -]+):(\d+):\d/,   // file.js:42:10  (JS/TS/Go/C/C++/Rust)
		/\.java:(\d+)\)/,                      // Java:    (MyClass.java:42)
		/[Ff]ile [^\n]+, line (\d+)/,          // Python:  File "x.py", line 42
		/line (\d+)/i,                          // generic  "line 42"
		/:(\d+):/,                              // generic  :42:
	];
	for (const p of patterns) {
		const m = text.match(p);
		if (m) {
			const n = parseInt(m[1], 10);
			if (!isNaN(n) && n > 0) { return n; }
		}
	}
	return null;
}

// ── Pre-compiled pattern index (built once at module load) ────────────────────

// Extract the longest leading literal from a regex source so we can skip
// patterns whose keyword isn't present in the output string.
function extractHint(src: string): string {
	let hint = '';
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === '\\' && i + 1 < src.length) {
			const next = src[i + 1];
			// only treat as literal if it's an alphanumeric escape (e.g. \[)
			if (/[a-zA-Z0-9[\]]/.test(next)) { hint += next; i += 2; continue; }
			break;
		}
		if (/[.^$|?*+()[\]{}]/.test(c)) break; // regex metachar — stop
		hint += c;
		i++;
	}
	return hint.toLowerCase().trim();
}

interface _Compiled {
	ep: ErrorPattern;
	hint: string;       // must appear in lowercased output, or '' (always run)
	global: RegExp;     // pre-compiled global version of ep.pattern
}

// Map from VS Code languageId → internal lang key used in _lang() calls above.
const _VSCODE_TO_LANG: Record<string, string> = {
	javascript: 'js',  javascriptreact: 'js',
	typescript: 'js',  typescriptreact: 'js',
	python:     'python',
	go:         'go',
	java:       'java',
	c:          'c',   cpp: 'c',
	rust:       'rust',
	ruby:       'ruby',
	php:        'php',
	csharp:     'csharp',
	shellscript:'bash', bash: 'bash', zsh: 'bash',
	kotlin:     'kotlin',
	swift:      'swift',
};

// Language-keyed index: only patterns for the relevant language are scanned.
const _LANG_INDEX = new Map<string, _Compiled[]>();
for (const ep of ERROR_LIBRARY) {
	const compiled: _Compiled = {
		ep,
		hint: extractHint(ep.pattern.source),
		global: new RegExp(ep.pattern.source,
			ep.pattern.flags.includes('g') ? ep.pattern.flags : ep.pattern.flags + 'g'),
	};
	const key = ep.lang ?? 'universal';
	const bucket = _LANG_INDEX.get(key) ?? [];
	bucket.push(compiled);
	_LANG_INDEX.set(key, bucket);
}

// ── diagnoseOutput ────────────────────────────────────────────────────────────

export function diagnoseOutput(output: string, vscodeLang: string): DiagnosisResult[] {
	const lang = _VSCODE_TO_LANG[vscodeLang] ?? vscodeLang;
	const candidates = _LANG_INDEX.get(lang) ?? [];
	const results: DiagnosisResult[] = [];
	const seen = new Set<string>();
	const lower = output.toLowerCase();

	for (const { ep, hint, global: re } of candidates) {
		// keyword not present → impossible to match, skip immediately
		if (hint && !lower.includes(hint)) continue;

		re.lastIndex = 0; // reset before each use (shared global regex)
		let match: RegExpExecArray | null;
		while ((match = re.exec(output)) !== null) {
			const key = re.source + '|' + match[0];
			if (seen.has(key)) { break; }
			seen.add(key);

			const contextStart = Math.max(0, match.index - 300);
			const context = output.slice(contextStart, match.index + match[0].length + 100);
			results.push({
				line: extractLineNumber(context),
				errorText: match[0],
				diagnosis: ep.explain(match),
				understood: true,
			});
		}
	}

	// Nothing matched — surface the most error-like lines as unknown
	if (results.length === 0) {
		const candidates = output
			.split('\n')
			.filter(l => /error|exception|fault|traceback|failed|undefined|cannot|unexpected|warning/i.test(l))
			.slice(0, 5);

		for (const l of candidates) {
			const trimmed = l.trim();
			if (trimmed) {
				results.push({ line: extractLineNumber(trimmed), errorText: trimmed, diagnosis: '', understood: false });
			}
		}

		if (results.length === 0) {
			results.push({ line: null, errorText: output.slice(0, 400).trim(), diagnosis: '', understood: false });
		}
	}

	return results;
}
