// Runs inside each compose editor. Hands the Claude panel the selected text, and replaces the
// selection on request.
'use strict';

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.claude) return undefined;
  const sel = window.getSelection();
  if (msg.claude === 'getSelection') return Promise.resolve({ text: sel ? String(sel) : '' });
  if (msg.claude === 'replaceSelection') {
    if (!sel || sel.isCollapsed) return Promise.resolve({ ok: false });
    const ok = msg.html
      ? document.execCommand('insertHTML', false, msg.html)
      : document.execCommand('insertText', false, msg.text);
    return Promise.resolve({ ok: !!ok });
  }
  return undefined;
});
