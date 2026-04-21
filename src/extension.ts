import * as vscode from 'vscode';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are an expert code reviewer. You will receive a JSON payload with three fields: "mode", "language", and "code".

Depending on the mode, focus your analysis as follows:
- CLARIFY: Identify confusing logic, poor naming, unclear intent, and missing context. Suggest how to make the code easier to understand.
- EFFICIENCY: Find performance bottlenecks, unnecessary allocations, redundant operations, and algorithmic inefficiencies. Suggest optimized alternatives.
- DOCUMENTATION: Identify missing or incorrect comments, undocumented public APIs, unclear parameter/return types, and missing examples.
- SECURITY: Find vulnerabilities, injection risks, unsafe operations, insecure data handling, and missing input validation.

You MUST return a single JSON object — no markdown fences, no prose, no explanation outside the JSON. The object must conform exactly to this schema:

{
  "summary": "<string: 1–3 sentence overall assessment>",
  "issues": [
    {
      "type": "<string: short label e.g. 'SQL Injection', 'Missing Null Check'>",
      "severity": "<'low' | 'medium' | 'high' | 'critical'>",
      "description": "<string: what the problem is>",
      "suggestion": "<string: how to fix it>",
      "code_fix": "<string: corrected code snippet, or null if not applicable>"
    }
  ],
  "refactored_code": "<string: full refactored version of the input code>"
}

If no issues are found, return an empty array for "issues". Always include "refactored_code" with the improved version.`;

type ReviewMode = 'CLARIFY' | 'EFFICIENCY' | 'DOCUMENTATION' | 'SECURITY';

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
		const fileName = document.fileName.split('/').pop() || document.fileName;
		const language = document.languageId;

		createReviewPanel(code, fileName, language, context);
	});

	context.subscriptions.push(disposable);
}

function createReviewPanel(code: string, fileName: string, language: string, context: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		'codeReview',
		`Review: ${fileName}`,
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = getWebviewContent(fileName, language);

	const config = vscode.workspace.getConfiguration('codeReviewBot');
	const apiKey = config.get<string>('apiKey') || process.env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		panel.webview.postMessage({
			type: 'error',
			message: 'No API key found. Set ANTHROPIC_API_KEY or configure codeReviewBot.apiKey in VS Code settings.',
		});
		return;
	}

	const client = new Anthropic({ apiKey });

	const listener = panel.webview.onDidReceiveMessage(msg => {
		if (msg.type === 'startReview') {
			const mode = msg.mode as string;
			if (mode !== 'CLARIFY' && mode !== 'EFFICIENCY' && mode !== 'DOCUMENTATION' && mode !== 'SECURITY') {
				panel.webview.postMessage({ type: 'error', message: `Invalid review mode: ${mode}` });
				return;
			}
			runReview(panel, client, code, language, mode as ReviewMode);
		}
	});

	context.subscriptions.push(listener);
}

async function runReview(
	panel: vscode.WebviewPanel,
	client: Anthropic,
	code: string,
	language: string,
	mode: ReviewMode
): Promise<void> {
	panel.webview.postMessage({ type: 'reviewing' });

	const userPayload = JSON.stringify({ mode, language, code });

	try {
		const stream = client.messages.stream({
			model: 'claude-opus-4-6',
			max_tokens: 16000,
			thinking: { type: 'adaptive' },
			output_config: { effort: 'max' },
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: userPayload }],
		});

		let buffer = '';
		for await (const event of stream) {
			if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
				buffer += event.delta.text;
			}
		}

		// Strip optional ```json fences
		const cleaned = buffer.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

		const parsed: unknown = JSON.parse(cleaned);
		if (!isReviewResult(parsed)) {
			throw new Error('Claude returned JSON that does not match the expected ReviewResult schema.');
		}

		panel.webview.postMessage({ type: 'result', data: parsed });
	} catch (error) {
		const message =
			error instanceof Anthropic.APIError
				? `API Error ${error.status}: ${error.message}`
				: error instanceof Error
				? error.message
				: String(error);
		panel.webview.postMessage({ type: 'error', message });
	}
}

function getWebviewContent(fileName: string, language: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px;
      line-height: 1.6;
    }

    #header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }

    #header h2 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }

    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-weight: 500;
    }

    .badge-mode {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .badge-low    { background: var(--vscode-charts-blue);   color: #fff; }
    .badge-medium { background: var(--vscode-charts-yellow); color: #000; }
    .badge-high   { background: var(--vscode-charts-orange); color: #fff; }
    .badge-critical { background: var(--vscode-charts-red);  color: #fff; }

    /* ── Phase containers ── */
    #mode-selector, #loading, #result { display: none; }
    #mode-selector.active, #loading.active, #result.active { display: block; }

    /* ── Mode selector ── */
    .mode-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }

    .mode-btn {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px 14px;
      cursor: pointer;
      text-align: left;
      color: var(--vscode-editor-foreground);
      transition: border-color 0.15s, background 0.15s;
    }

    .mode-btn:hover {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }

    .mode-btn.selected {
      border-color: var(--vscode-button-background);
      background: var(--vscode-button-secondaryBackground, var(--vscode-list-activeSelectionBackground));
    }

    .mode-btn .mode-name {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
    }

    .mode-btn .mode-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .run-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 8px 18px;
      font-size: 13px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
    }

    .run-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .run-btn:not(:disabled):hover {
      background: var(--vscode-button-hoverBackground);
    }

    /* ── Loading ── */
    #loading {
      display: none;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }

    #loading.active { display: flex; }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: var(--vscode-focusBorder);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Result ── */
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .card-title {
      font-weight: 600;
      font-size: 13px;
    }

    .summary-text {
      font-size: 13px;
      line-height: 1.6;
    }

    .issue-description {
      font-size: 12px;
      margin-bottom: 6px;
      color: var(--vscode-editor-foreground);
    }

    .suggestion-box {
      background: var(--vscode-textCodeBlock-background);
      border-left: 3px solid var(--vscode-focusBorder);
      border-radius: 0 3px 3px 0;
      padding: 8px 10px;
      font-size: 12px;
      margin-bottom: 8px;
    }

    .suggestion-label {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 3px;
    }

    pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 0;
    }

    pre code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.88em;
    }

    .refactored-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .refactored-title {
      font-weight: 600;
      font-size: 13px;
    }

    .copy-btn {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 3px 10px;
      font-size: 11px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
    }

    .copy-btn:hover { border-color: var(--vscode-focusBorder); }

    .try-again-btn {
      margin-top: 14px;
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }

    .try-again-btn:hover { border-color: var(--vscode-focusBorder); }

    .error-box {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      padding: 10px 14px;
      font-size: 12px;
      margin-bottom: 12px;
    }

    .section-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 16px 0 8px;
    }

    .no-issues {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div id="header">
    <h2>${escapeHtml(fileName)}</h2>
    <span class="badge">${escapeHtml(language)}</span>
  </div>

  <!-- Phase 1: Mode selector -->
  <div id="mode-selector" class="active">
    <div class="mode-grid">
      <button class="mode-btn" data-mode="CLARIFY">
        <div class="mode-name">CLARIFY</div>
        <div class="mode-desc">Find confusing logic and improve readability</div>
      </button>
      <button class="mode-btn" data-mode="EFFICIENCY">
        <div class="mode-name">EFFICIENCY</div>
        <div class="mode-desc">Detect performance bottlenecks and redundant work</div>
      </button>
      <button class="mode-btn" data-mode="DOCUMENTATION">
        <div class="mode-name">DOCUMENTATION</div>
        <div class="mode-desc">Identify missing or incorrect comments and docs</div>
      </button>
      <button class="mode-btn" data-mode="SECURITY">
        <div class="mode-name">SECURITY</div>
        <div class="mode-desc">Find vulnerabilities and unsafe operations</div>
      </button>
    </div>
    <button id="run-btn" class="run-btn" disabled>Run Review</button>
  </div>

  <!-- Phase 2: Loading -->
  <div id="loading">
    <span class="spinner"></span>
    <span id="loading-text">Reviewing with Claude...</span>
  </div>

  <!-- Phase 3: Result -->
  <div id="result"></div>

  <script>
    const vscode = acquireVsCodeApi();

    // ── State machine ──
    let state = 'idle';
    let selectedMode = null;

    const modeSelectorEl = document.getElementById('mode-selector');
    const loadingEl = document.getElementById('loading');
    const resultEl = document.getElementById('result');
    const runBtn = document.getElementById('run-btn');
    const loadingText = document.getElementById('loading-text');

    function setState(s) {
      state = s;
      modeSelectorEl.className = s === 'idle' ? 'active' : '';
      loadingEl.className = s === 'reviewing' ? 'active' : '';
      resultEl.className = s === 'done' ? 'active' : '';
    }

    // ── Mode selection ──
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMode = btn.getAttribute('data-mode');
        runBtn.disabled = false;
      });
    });

    runBtn.addEventListener('click', () => {
      if (!selectedMode) return;
      loadingText.textContent = 'Reviewing with Claude (' + selectedMode + ' mode)...';
      setState('reviewing');
      vscode.postMessage({ type: 'startReview', mode: selectedMode });
    });

    // ── Message handler ──
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'reviewing':
          setState('reviewing');
          break;

        case 'result':
          renderResult(msg.data);
          setState('done');
          break;

        case 'error':
          renderError(msg.message || 'An unexpected error occurred.');
          setState('done');
          break;
      }
    });

    // ── Renderers ──
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function severityBadge(severity) {
      return '<span class="badge badge-' + severity + '">' + severity.toUpperCase() + '</span>';
    }

    function renderResult(data) {
      const parts = [];

      // Summary card
      parts.push(
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">Summary</span>' +
            '<span class="badge badge-mode">' + escapeHtml(selectedMode) + '</span>' +
          '</div>' +
          '<p class="summary-text">' + escapeHtml(data.summary) + '</p>' +
        '</div>'
      );

      // Issues
      if (data.issues && data.issues.length > 0) {
        parts.push('<div class="section-label">Issues (' + data.issues.length + ')</div>');
        for (const issue of data.issues) {
          let issueHtml =
            '<div class="card">' +
              '<div class="card-header">' +
                '<span class="card-title">' + escapeHtml(issue.type) + '</span>' +
                severityBadge(issue.severity) +
              '</div>' +
              '<p class="issue-description">' + escapeHtml(issue.description) + '</p>' +
              '<div class="suggestion-box">' +
                '<div class="suggestion-label">Suggestion</div>' +
                escapeHtml(issue.suggestion) +
              '</div>';

          if (issue.code_fix) {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = issue.code_fix;
            pre.appendChild(code);
            issueHtml += pre.outerHTML;
          }

          issueHtml += '</div>';
          parts.push(issueHtml);
        }
      } else {
        parts.push(
          '<div class="card">' +
            '<p class="no-issues">No issues found for this mode.</p>' +
          '</div>'
        );
      }

      // Refactored code
      parts.push('<div class="section-label">Refactored Code</div>');
      parts.push('<div class="card">');
      parts.push(
        '<div class="refactored-header">' +
          '<span class="refactored-title">Improved Version</span>' +
          '<button class="copy-btn" id="copy-btn">Copy</button>' +
        '</div>'
      );
      const refPre = document.createElement('pre');
      const refCode = document.createElement('code');
      refCode.id = 'refactored-code-text';
      refCode.textContent = data.refactored_code;
      refPre.appendChild(refCode);
      parts.push(refPre.outerHTML);
      parts.push('</div>');

      // Try Again
      parts.push('<button class="try-again-btn" id="try-again-btn">Try Again</button>');

      resultEl.innerHTML = parts.join('');

      // Copy button
      const copyBtn = document.getElementById('copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const codeEl = document.getElementById('refactored-code-text');
          if (codeEl) {
            navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
            });
          }
        });
      }

      // Try Again button
      const tryAgainBtn = document.getElementById('try-again-btn');
      if (tryAgainBtn) {
        tryAgainBtn.addEventListener('click', resetToIdle);
      }
    }

    function renderError(message) {
      resultEl.innerHTML =
        '<div class="error-box">' + escapeHtml(message) + '</div>' +
        '<button class="try-again-btn" id="try-again-btn">Try Again</button>';

      const tryAgainBtn = document.getElementById('try-again-btn');
      if (tryAgainBtn) {
        tryAgainBtn.addEventListener('click', resetToIdle);
      }
    }

    function resetToIdle() {
      selectedMode = null;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
      runBtn.disabled = true;
      resultEl.innerHTML = '';
      setState('idle');
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function deactivate() {}
