/**
 * animations.ts — all visual effects for the review panel.
 * Import getAnimationStyles() and getAnimationScripts() into getWebviewContent().
 * To remove all animations, delete this file and remove the two injection calls.
 */

export function getAnimationStyles(): string {
	return `
    /* ── Entrance: sections rise in on load ── */
    @keyframes anim-rise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: none; }
    }

    #header             { animation: anim-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.00s both; }
    #code-bar           { animation: anim-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.07s both; }
    #debug-section      { animation: anim-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.14s both; }
    #cheatsheet-section { animation: anim-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.21s both; }
    #help-section       { animation: anim-rise 0.45s cubic-bezier(0.22,1,0.36,1) 0.28s both; }

    /* ── Mode buttons: smooth transitions + soft glow when active (no outline) ── */
    .code-btn {
      transition: opacity 0.15s ease, background 0.15s ease,
                  box-shadow 0.22s ease, transform 0.15s ease;
    }

    .code-btn.active {
      box-shadow: 0 20px 100px rgba(122, 28, 172, 0.28);
    }

    /* ── Cards: lift on hover ── */
    .card {
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
    }

    /* ── Debug results: slide in from the left ── */
    @keyframes anim-debug-in {
      from { opacity: 0; transform: translateX(-8px); }
      to   { opacity: 1; transform: none; }
    }

    .debug-result {
      animation: anim-debug-in 0.25s cubic-bezier(0.22,1,0.36,1) both;
    }

    /* ── Debug run button: pulse while running ── */
    @keyframes anim-btn-pulse {
      0%, 100% { opacity: 0.35; }
      50%       { opacity: 0.60; }
    }

    #debug-run-btn:disabled {
      animation: anim-btn-pulse 1.6s ease-in-out infinite;
    }

    /* ── Cheatsheet: code block fades + slides in on topic change ── */
    @keyframes anim-code-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: none; }
    }

    .anim-code-in {
      animation: anim-code-in 0.22s cubic-bezier(0.22,1,0.36,1) both;
    }

    /* ── Help tips: highlight on hover ── */
    .help-tip {
      transition: background 0.15s ease, border-left-color 0.2s ease,
                  transform 0.15s ease;
    }

    .help-tip:hover {
      background: var(--bg-hover);
      transform: translateX(2px);
    }

    /* ── Help section: fade in when opened ── */
    @keyframes anim-help-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: none; }
    }

    #help-body:not([hidden]) {
      animation: anim-help-in 0.22s cubic-bezier(0.22,1,0.36,1) both;
    }

    /* ── Copy button: flash green on success ── */
    @keyframes anim-copy-flash {
      0%   { color: var(--fg-body); border-color: var(--border); }
      30%  { color: #4caf50;        border-color: #4caf50; }
      100% { color: var(--fg-body); border-color: var(--border); }
    }

    .copy-flash {
      animation: anim-copy-flash 1.2s ease both;
    }
  `;
}

export function getAnimationScripts(): string {
	return `
  // ── Animations (animations.ts) ──
  (function () {

    // 1. Cheatsheet: animate code block whenever a topic is selected
    const cheatSelect = document.getElementById('cheatsheet-select');
    const cheatBody   = document.getElementById('cheatsheet-body');
    const cheatPre    = document.getElementById('cheatsheet-code')?.parentElement;

    if (cheatSelect && cheatPre) {
      cheatSelect.addEventListener('change', () => {
        requestAnimationFrame(() => {
          if (!cheatBody.hidden) {
            cheatPre.classList.remove('anim-code-in');
            void cheatPre.offsetWidth;
            cheatPre.classList.add('anim-code-in');
          }
        });
      });
    }

    // 2. Help section: simple hidden toggle with CSS fade-in handling the animation
    const helpToggle = document.getElementById('help-toggle-btn');
    const helpBody   = document.getElementById('help-body');
    const helpHeader = document.getElementById('help-header');

    if (helpToggle && helpBody) {
      helpToggle.addEventListener('click', () => {
        const opening = helpBody.hidden;
        helpBody.hidden = !opening;
        helpToggle.textContent = opening ? 'Close' : 'Open';
        helpHeader.classList.toggle('open', opening);
      });
    }

    // 3. Copy buttons: flash green instead of just changing text
    document.addEventListener('click', e => {
      const btn = e.target;
      if (btn && btn.classList && btn.classList.contains('copy-btn')) {
        btn.classList.remove('copy-flash');
        void btn.offsetWidth;
        btn.classList.add('copy-flash');
        btn.addEventListener('animationend', () => btn.classList.remove('copy-flash'), { once: true });
      }
    });

  })();
  `;
}
