// Task pane glue: reads the current item, calls Claude, writes the result back.
// ES5 + callbacks only (IE11-hosted classic Outlook). Depends on Prompts, Claude, Office.
(function (root) {
  'use strict';

  var doc = root.document;
  var state = { compose: false, source: null, result: '', xhr: null, cancelled: false };
  var started = false;

  function $(id) { return doc.getElementById(id); }
  function show(el, on) { el.style.display = on ? '' : 'none'; }

  function mailbox() { return root.Office.context.mailbox; }
  function item() { return mailbox().item; }
  function settings() { return root.Office.context.roamingSettings; }
  function ok(r) { return r.status === root.Office.AsyncResultStatus.Succeeded; }
  function errText(r) { return (r.error && r.error.message) || 'Outlook refused the request.'; }

  function status(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------- settings ----------

  function loadSettings() {
    var s = settings();
    return {
      apiKey: s.get('apiKey') || '',
      model: s.get('model') || root.Claude.DEFAULT_MODEL,
      context: s.get('context') || ''
    };
  }

  function fillSettingsForm() {
    var cfg = loadSettings();
    var sel = $('model');
    sel.innerHTML = '';
    for (var i = 0; i < root.Claude.MODELS.length; i++) {
      var m = root.Claude.MODELS[i];
      var opt = doc.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      if (m.id === cfg.model) opt.selected = true;
      sel.appendChild(opt);
    }
    $('apiKey').value = '';
    $('apiKey').placeholder = cfg.apiKey ? 'Saved (ends ' + cfg.apiKey.slice(-4) + '). Paste to replace.' : 'sk-ant-...';
    $('context').value = cfg.context;
  }

  function saveSettings() {
    var s = settings();
    var key = $('apiKey').value.replace(/^\s+|\s+$/g, '');
    if (key && key.indexOf('sk-ant-') !== 0) { status('That doesn\'t look like an Anthropic key (sk-ant-...).', 'error'); return; }
    if (key) s.set('apiKey', key);
    s.set('model', $('model').value);
    s.set('context', $('context').value);
    s.saveAsync(function (r) {
      if (!ok(r)) { status('Could not save settings: ' + errText(r), 'error'); return; }
      fillSettingsForm();
      status('Settings saved.', 'good');
      if (loadSettings().apiKey) toggleSettings(false);
    });
  }

  function clearKey() {
    var s = settings();
    s.remove('apiKey');
    s.saveAsync(function (r) {
      if (!ok(r)) { status('Could not clear the key: ' + errText(r), 'error'); return; }
      fillSettingsForm();
      status('API key removed.', 'good');
    });
  }

  function toggleSettings(on) {
    if (on === undefined) on = $('settings').style.display === 'none';
    show($('settings'), on);
    if (on) fillSettingsForm();
  }

  // ---------- reading the item ----------

  function readMessage(cb) {
    var it = item();
    it.body.getAsync(root.Office.CoercionType.Text, function (r) {
      if (!ok(r)) { cb({ error: 'Could not read the email: ' + errText(r) }); return; }
      cb({ msg: {
        subject: it.subject, from: it.from, to: it.to, cc: it.cc,
        date: it.dateTimeCreated ? String(it.dateTimeCreated) : '',
        body: r.value
      } });
    });
  }

  // Selected text if any, else the whole body. cb({ text, scope, subject } | { error })
  function readDraft(cb) {
    var it = item();
    it.subject.getAsync(function (sr) {
      var subject = ok(sr) ? sr.value : '';
      it.getSelectedDataAsync(root.Office.CoercionType.Text, function (r) {
        if (ok(r) && r.value && /\S/.test(r.value.data || '')) {
          cb({ text: r.value.data, scope: 'selection', subject: subject });
          return;
        }
        it.body.getAsync(root.Office.CoercionType.Text, function (br) {
          if (!ok(br)) { cb({ error: 'Could not read the draft: ' + errText(br) }); return; }
          cb({ text: br.value, scope: 'body', subject: subject });
        });
      });
    });
  }

  // ---------- running an action ----------

  function setBusy(on) {
    var buttons = doc.querySelectorAll('button.act');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
    show($('cancel'), on);
  }

  function run(action) {
    var cfg = loadSettings();
    if (!cfg.apiKey) { toggleSettings(true); status('Paste your Anthropic API key first.', 'error'); return; }
    var extra = $('extra').value.replace(/^\s+|\s+$/g, '');
    setBusy(true);
    state.cancelled = false;
    show($('output-wrap'), false);
    status('Reading the email...');

    var gather = state.compose ? readDraft : readMessage;
    gather(function (got) {
      if (got.error) { setBusy(false); status(got.error, 'error'); return; }
      var prompt;
      try {
        prompt = state.compose
          ? root.Prompts.buildCompose(action, got.text, extra, { subject: got.subject })
          : root.Prompts.buildRead(action, got.msg, extra);
      } catch (e) { setBusy(false); status(e.message, 'error'); return; }
      state.source = state.compose ? got.scope : 'message';
      status('Claude is working (' + cfg.model + ')...');
      state.xhr = root.Claude.send({
        apiKey: cfg.apiKey, model: cfg.model,
        system: root.Prompts.system(cfg.context), prompt: prompt
      }, function (res) {
        state.xhr = null;
        setBusy(false);
        if (state.cancelled) { status('Cancelled.'); return; }
        if (res.error) { status(res.error, 'error'); return; }
        showResult(res.text, action);
      });
    });
  }

  function cancel() {
    state.cancelled = true;
    if (state.xhr) state.xhr.abort();
  }

  function showResult(text, action) {
    state.result = text;
    $('output').textContent = text;
    var read = !state.compose;
    show($('use-reply'), read);
    show($('use-replyall'), read);
    show($('use-insert'), !read);
    show($('use-body'), !read);
    $('use-insert').textContent = state.source === 'selection' ? 'Replace selection' : 'Insert at cursor';
    show($('body-warning'), !read);
    show($('output-wrap'), true);
    status(read && action === 'reply' ? 'Draft ready. Open it as a reply to edit and send.' : 'Done.', 'good');
  }

  // ---------- writing back ----------

  function withBodyType(cb) {
    item().body.getTypeAsync(function (r) {
      cb(ok(r) && r.value === root.Office.CoercionType.Text ? 'text' : 'html');
    });
  }

  function insertResult() {
    var it = item();
    withBodyType(function (type) {
      var html = type === 'html';
      it.body.setSelectedDataAsync(html ? root.Prompts.textToHtml(state.result) : state.result,
        { coercionType: html ? root.Office.CoercionType.Html : root.Office.CoercionType.Text },
        function (r) { status(ok(r) ? 'Inserted into the email.' : 'Insert failed: ' + errText(r), ok(r) ? 'good' : 'error'); });
    });
  }

  function replaceBody() {
    var it = item();
    withBodyType(function (type) {
      var html = type === 'html';
      it.body.setAsync(html ? root.Prompts.textToHtml(state.result) : state.result,
        { coercionType: html ? root.Office.CoercionType.Html : root.Office.CoercionType.Text },
        function (r) { status(ok(r) ? 'Email body replaced.' : 'Replace failed: ' + errText(r), ok(r) ? 'good' : 'error'); });
    });
  }

  function openReply(all) {
    var html = root.Prompts.textToHtml(state.result);
    if (all) item().displayReplyAllForm(html); else item().displayReplyForm(html);
    status('Reply opened.', 'good');
  }

  function copyResult() {
    var ta = doc.createElement('textarea');
    ta.value = state.result;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute'; ta.style.left = '-9999px';
    doc.body.appendChild(ta);
    ta.select();
    var copied = false;
    try { copied = doc.execCommand('copy'); } catch (e) { copied = false; }
    doc.body.removeChild(ta);
    status(copied ? 'Copied.' : 'Copy blocked here. Select the text and press Ctrl+C.', copied ? 'good' : 'error');
  }

  // ---------- mode + wiring ----------

  function detectMode() {
    var it = item();
    state.compose = !!(it && it.subject && typeof it.subject === 'object' && it.subject.getAsync);
    show($('read-actions'), !state.compose);
    show($('compose-actions'), state.compose);
    $('mode').textContent = state.compose ? 'Composing' : 'Reading';
    $('extra').placeholder = state.compose
      ? 'Optional: extra instructions, or a full instruction for "Do it"'
      : 'Optional: instructions for the reply, or a question for "Ask"';
    show($('output-wrap'), false);
    status(state.compose ? 'Works on the selected text, or on the whole draft if nothing is selected.' : '');
  }

  function on(id, fn) { $(id).addEventListener('click', fn); }

  function wire() {
    var acts = doc.querySelectorAll('button[data-action]');
    for (var i = 0; i < acts.length; i++) {
      (function (b) { b.addEventListener('click', function () { run(b.getAttribute('data-action')); }); })(acts[i]);
    }
    on('cancel', cancel);
    on('use-reply', function () { openReply(false); });
    on('use-replyall', function () { openReply(true); });
    on('use-insert', insertResult);
    on('use-body', replaceBody);
    on('use-copy', copyResult);
    on('open-settings', function () { toggleSettings(); });
    on('save-settings', saveSettings);
    on('clear-key', clearKey);
  }

  function start() {
    if (started) return;
    started = true;
    wire();
    detectMode();
    var mb = mailbox();
    // A pinned pane stays open while the user moves between emails (Mailbox 1.5+).
    if (mb.addHandlerAsync && root.Office.EventType && root.Office.EventType.ItemChanged) {
      mb.addHandlerAsync(root.Office.EventType.ItemChanged, function () { if (item()) detectMode(); });
    }
    if (!loadSettings().apiKey) { toggleSettings(true); status('First run: paste your Anthropic API key and save.'); }
  }

  root.ClaudePane = { start: start, state: state };

  if (root.Office) {
    if (root.Office.onReady) root.Office.onReady(function () { start(); });
    else root.Office.initialize = function () { start(); };
  }
})(this);
