// Claude panel window: reads the message or draft in the tab it was opened for, calls Claude,
// and writes the result back. Opened by background.js as panel.html?tab=<id>; with no tab it is
// the settings page. Depends on Prompts, Claude, ClaudeMail and messenger.
(function (root) {
  'use strict';

  const doc = root.document;
  const tb = root.messenger;
  const state = { tabId: 0, compose: false, plain: false, scope: '', message: null, xhr: null, cancelled: false, timer: 0 };

  const $ = (id) => doc.getElementById(id);
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const parser = () => new root.DOMParser();

  function status(msg, kind) {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------- settings ----------

  async function loadSettings() {
    const s = await tb.storage.local.get(['apiKey', 'model', 'context']);
    return { apiKey: s.apiKey || '', model: s.model || root.Claude.DEFAULT_MODEL, context: s.context || '' };
  }

  async function fillSettingsForm() {
    const cfg = await loadSettings();
    const sel = $('model');
    sel.innerHTML = '';
    for (const m of root.Claude.MODELS) {
      const opt = doc.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      if (m.id === cfg.model) opt.selected = true;
      sel.appendChild(opt);
    }
    $('apiKey').value = '';
    $('apiKey').placeholder = cfg.apiKey ? 'Saved (ends ' + cfg.apiKey.slice(-4) + '). Paste to replace.' : 'sk-ant-api03-...';
    $('context').value = cfg.context;
  }

  async function saveSettings() {
    const key = $('apiKey').value.trim();
    const problem = key ? root.ClaudeMail.keyProblem(key) : null;
    if (problem) { status(problem, 'error'); return; }
    const values = { model: $('model').value, context: $('context').value };
    if (key) values.apiKey = key;
    await tb.storage.local.set(values);
    await fillSettingsForm();
    status('Settings saved.', 'good');
    if (state.tabId && (await loadSettings()).apiKey) await toggleSettings(false);
  }

  async function clearKey() {
    await tb.storage.local.remove('apiKey');
    await fillSettingsForm();
    status('API key removed.', 'good');
  }

  async function toggleSettings(on) {
    const open = on === undefined ? $('settings').style.display === 'none' : on;
    show($('settings'), open);
    if (open) await fillSettingsForm();
  }

  // ---------- reading the tab ----------

  async function toPlain(html) {
    const mu = tb.messengerUtilities;
    if (mu && mu.convertToPlainText) {
      try { return await mu.convertToPlainText(html); } catch (e) { /* older build: fall through to the DOM version */ }
    }
    return root.ClaudeMail.htmlToText(html, parser());
  }

  async function readMessage() {
    const list = await tb.messageDisplay.getDisplayedMessages(state.tabId);
    const msgs = (list && list.messages) || [];
    if (!msgs.length) throw new Error('No email is open in that tab. Select one and try again.');
    const header = msgs[0];
    const pick = root.ClaudeMail.pickText(await tb.messages.listInlineTextParts(header.id));
    const body = !pick ? '' : pick.type === 'plain' ? pick.content : await toPlain(pick.content);
    state.message = header;
    return { msg: root.ClaudeMail.emailInfo(header, body), note: msgs.length > 1 ? 'Several emails selected; used the first. ' : '' };
  }

  async function composeSelection() {
    try {
      const r = await tb.tabs.sendMessage(state.tabId, { claude: 'getSelection' });
      return r && /\S/.test(r.text || '') ? r.text : '';
    } catch (e) {
      return ''; // no helper in this compose window (opened before the add-in loaded): use the draft
    }
  }

  async function readDraft() {
    const d = await tb.compose.getComposeDetails(state.tabId);
    state.plain = !!d.isPlainText;
    const sel = await composeSelection();
    if (sel) return { text: sel, scope: 'selection', subject: d.subject || '' };
    const own = state.plain
      ? root.ClaudeMail.splitDraftPlain(d.plainTextBody).own
      : root.ClaudeMail.splitDraftHtml(d.body, parser()).text;
    return { text: own, scope: 'own', subject: d.subject || '' };
  }

  // ---------- running an action ----------

  function setBusy(on, model) {
    for (const b of doc.querySelectorAll('button.act')) b.disabled = on;
    show($('cancel'), on);
    root.clearInterval(state.timer);
    if (!on) return;
    const t0 = Date.now();
    const tick = () => status('Claude is working (' + model + ')... ' + Math.round((Date.now() - t0) / 1000) + 's');
    tick();
    state.timer = root.setInterval(tick, 1000);
  }

  function ask(cfg, prompt) {
    return new Promise((resolve) => {
      state.xhr = root.Claude.send({
        apiKey: cfg.apiKey, model: cfg.model, system: root.ClaudeMail.systemPrompt(cfg.context), prompt
      }, resolve);
    });
  }

  async function run(action) {
    const cfg = await loadSettings();
    const problem = root.ClaudeMail.keyProblem(cfg.apiKey);
    if (problem) { await toggleSettings(true); status(problem, 'error'); return; }
    const extra = $('extra').value.trim();
    state.cancelled = false;
    show($('output-wrap'), false);
    for (const b of doc.querySelectorAll('button.act')) b.disabled = true;
    status(state.compose ? 'Reading the draft...' : 'Reading the email...');

    let prompt, note = '';
    try {
      if (state.compose) {
        const got = await readDraft();
        state.scope = got.scope;
        prompt = root.Prompts.buildCompose(action, got.text, extra, { subject: got.subject });
      } else {
        const got = await readMessage();
        note = got.note;
        prompt = root.Prompts.buildRead(action, got.msg, extra);
      }
    } catch (e) {
      setBusy(false);
      status(e.message, 'error');
      return;
    }

    setBusy(true, cfg.model);
    const res = await ask(cfg, prompt);
    state.xhr = null;
    setBusy(false);
    if (state.cancelled) { status('Cancelled.'); return; }
    if (res.error) { status(res.error, 'error'); return; }
    showResult(res.text, action, note);
  }

  function cancel() {
    state.cancelled = true;
    if (state.xhr) state.xhr.abort();
  }

  function showResult(text, action, note) {
    $('output').value = text;
    const read = !state.compose;
    show($('use-reply'), read);
    show($('use-replyall'), read);
    show($('use-selection'), !read && state.scope === 'selection');
    show($('use-own'), !read);
    show($('compose-hint'), !read);
    show($('output-wrap'), true);
    status((note || '') + (read && action === 'reply' ? 'Draft ready. Open it as a reply to edit and send.' : 'Done.'), 'good');
  }

  // ---------- writing back ----------

  const result = () => $('output').value;

  async function guarded(fn) {
    try { await fn(); } catch (e) { status(e.message || String(e), 'error'); }
  }

  async function openReply(all) {
    const tab = await tb.compose.beginReply(state.message.id, all ? 'replyToAll' : 'replyToSender');
    const d = await tb.compose.getComposeDetails(tab.id);
    await tb.compose.setComposeDetails(tab.id, d.isPlainText
      ? { plainTextBody: root.ClaudeMail.insertAtStartPlain(d.plainTextBody, result()) }
      : { body: root.ClaudeMail.insertAtStartHtml(d.body, result(), parser()) });
    status('Reply opened.', 'good');
  }

  async function replaceSelection() {
    const tab = await tb.tabs.get(state.tabId);
    await tb.windows.update(tab.windowId, { focused: true });
    const r = await tb.tabs.sendMessage(state.tabId, state.plain
      ? { claude: 'replaceSelection', text: result() }
      : { claude: 'replaceSelection', html: root.Prompts.textToHtml(result()) });
    if (r && r.ok) status('Selection replaced.', 'good');
    else status('The selection is gone. Select the text again, or use Copy.', 'error');
  }

  async function replaceOwn() {
    const d = await tb.compose.getComposeDetails(state.tabId);
    await tb.compose.setComposeDetails(state.tabId, d.isPlainText
      ? { plainTextBody: root.ClaudeMail.replaceOwnPlain(d.plainTextBody, result()) }
      : { body: root.ClaudeMail.replaceOwnHtml(d.body, result(), parser()) });
    status('Your text was replaced. The quote and signature are untouched.', 'good');
  }

  async function copyResult() {
    await root.navigator.clipboard.writeText(result());
    status('Copied.', 'good');
  }

  // ---------- mode + wiring ----------

  function on(id, fn) { $(id).addEventListener('click', () => guarded(fn)); }

  function wire() {
    for (const b of doc.querySelectorAll('button[data-action]')) {
      b.addEventListener('click', () => guarded(() => run(b.getAttribute('data-action'))));
    }
    on('cancel', cancel);
    on('use-reply', () => openReply(false));
    on('use-replyall', () => openReply(true));
    on('use-selection', replaceSelection);
    on('use-own', replaceOwn);
    on('use-copy', copyResult);
    on('open-settings', () => toggleSettings());
    on('save-settings', saveSettings);
    on('clear-key', clearKey);
  }

  async function start() {
    wire();
    state.tabId = Number(new root.URLSearchParams(root.location.search).get('tab')) || 0;
    if (!state.tabId) {
      $('mode').textContent = 'Settings';
      show($('open-settings'), false);
      await toggleSettings(true);
      return;
    }
    const tab = await tb.tabs.get(state.tabId);
    state.compose = tab.type === 'messageCompose';
    $('mode').textContent = state.compose ? 'Composing' : 'Reading';
    show($('read-actions'), !state.compose);
    show($('compose-actions'), state.compose);
    show($('ask-box'), true);
    $('extra').placeholder = state.compose
      ? 'Optional: extra instructions, or a full instruction for "Do it"'
      : 'Optional: instructions for the reply, or a question for "Ask"';
    if (!(await loadSettings()).apiKey) {
      await toggleSettings(true);
      status('First run: paste your Anthropic API key and save.');
    } else {
      status(state.compose ? 'Works on the selected text, or on your part of the draft if nothing is selected.' : '');
    }
  }

  root.ClaudePanel = { state, ready: start().catch((e) => status(e.message || String(e), 'error')) };
})(this);
