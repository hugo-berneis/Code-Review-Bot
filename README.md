# code-review-bot

A VS Code extension built for developers who want instant feedback without leaving their editor. It combines an **AI-powered code reviewer** using a fully local model with a **pattern-based Debug Checker** that explains runtime errors. No internet connection and no API keys.

---

## Requirements

### 1. Download and install Ollama

Ollama runs the AI model locally on your machine.

1. Go to [https://ollama.com](https://ollama.com) and download the installer for your OS
2. Run the installer and follow the setup steps
3. Once installed, open a terminal and start Ollama:

```bash
ollama serve
```

4. Pull the model used by this extension:

```bash
ollama pull qwen2.5-coder:7b
```

> The model is about 4.7 GB. It only needs to be downloaded once.

### 2. Install the extension

- Clone or download this repository
- Open the folder in VS Code
- Press `F5` to launch the Extension Development Host

### 3. Open the panel

- Open any source file
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and run **Open Code Review**
- The panel opens beside your editor

> **Note:** If you switch to a file in a different language, close and reopen the panel so the language is detected correctly.

---

## Features

### AI Code Review — C O D E bar

Four review modes powered by `qwen2.5-coder:7b` running locally through Ollama. Select a mode and click **Run**.

| Button | Mode | What it checks |
|--------|------|----------------|
| **C** | Clarify | Readability, naming, confusing logic |
| **O** | Oversight | Security vulnerabilities, unsafe operations |
| **D** | Documentation | Missing comments, unclear parameters, undocumented APIs |
| **E** | Efficiency | Performance bottlenecks, redundant operations, algorithmic improvements |

- Results include a **summary**, per-issue cards with severity labels (`low` / `medium` / `high` / `critical`), and an improved version of your code with a **Copy** button
- Each mode result is cached — switching tabs doesn't re-run
- The panel **auto-saves** your file before running so it always reviews your latest code
- No API key required — everything runs on your machine

---

### Debug Checker

Runs your file and explains any errors found — **no AI, no internet, pure pattern matching**.

- Click **Run & Diagnose** to execute the file and scan stderr for known error patterns
- The panel **auto-saves** before running so you always get results for your current code
- Supports **384 error patterns** across 12 languages

**Supported languages:**

| Language | How it runs |
|----------|-------------|
| JavaScript | `node` |
| TypeScript | `npx ts-node` |
| Python | `python3` |
| Go | `go run` |
| Java | `javac` + `java` |
| C | `gcc` + binary |
| C++ | `g++` + binary |
| Rust | `cargo run` |

**C / C++ compilation cache:** Compilation starts in the background the moment you open the panel. By the time you click Run & Diagnose, the binary is usually already built. The binary is cached by file content hash so unchanged files never recompile.

---

### Cheatsheet

A built-in quick reference for beginner programmers. The language is **auto-detected** from your open file.

Select a topic from the dropdown to instantly see a code snippet with a **Copy** button.

**Topics covered:**

| | | |
|---|---|---|
| Character Output | User Input | Program Structure |
| Conditionals | Comments | Relational Operators |
| Compile & Execute | Random Number | Variables & Data Types |
| Loops | Logical Operations | Arithmetic Operators |
| Chaining | | |

**Languages with cheatsheet support:**
JavaScript, TypeScript, Python, Go, Java, C, C++, Rust, Ruby, PHP, C#, Kotlin, Swift, Bash/Shell

---

### Help & Common Issues

A collapsible reference section at the bottom of the panel. Click **Open** to expand it.

Covers the most common problems beginners run into:

- What to do when switching languages
- Why the Debug Checker may say "not supported"
- Why C/C++ takes longer on the first run
- What to do if Ollama isn't running
- Why "No errors detected" doesn't mean the program is correct
- What to do if results seem stale
- Why programs that ask for keyboard input hang

---

## Known Issues

- **Ollama must be running** for the AI review modes (C, O, D, E). The Debug Checker works completely offline.
- **C/C++ with `#include <bits/stdc++.h>`** can take 10–15 seconds to compile on the first run. Subsequent runs are near-instant due to binary caching.
- **Programs that read from stdin** (`input()`, `scanf()`, `readline()`, etc.) will hang in the Debug Checker until the 15-second timeout. Temporarily comment out input calls while debugging.
- **Debug Checker reads stderr only** — logic errors that produce wrong output without crashing will not be detected. Use the AI review modes for logic analysis.
- The extension panel is tied to the language of the file it was opened on. Reopen the panel when switching languages.

---

## Release Notes

### 1.0.0

Initial release.

- AI code review via local Ollama (`qwen2.5-coder:7b`) with four modes: Clarify, Oversight, Documentation, Efficiency
- Pattern-based Debug Checker with 384 error patterns across 12 languages
- C/C++ binary cache with background pre-compilation
- Beginner Cheatsheet for 14 languages across 13 topics
- Help & Common Issues collapsible reference section
- Auto-save before running review or debug
- Ollama availability warning on panel open
- Smooth entrance animations and hover effects (contained in `src/animations.ts` for easy removal)
