// Drives the real task pane in jsdom against a fake Office mailbox and a fake API.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const HTML = read('taskpane.html').replace(/<script[\s\S]*?<\/script>/g, '');
const OK = { status: 'succeeded' };
const tick = () => new Promise((r) => setTimeout(r, 5));

function roaming(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    remove: (k) => { delete data[k]; },
    saveAsync: (cb) => cb(OK)
  };
}

function readItem(calls) {
  return {
    subject: 'Backup job failed',
    from: { displayName: 'Dana', emailAddress: 'dana@client.example' },
    to: [{ displayName: 'Keith', emailAddress: 'keith@msp.example' }],
    cc: [],
    dateTimeCreated: new Date('2026-10-22T08:00:00Z'),
    body: { getAsync: (type, cb) => cb(Object.assign({ value: 'Veeam job failed twice overnight.' }, OK)) },
    displayReplyForm: (html) => calls.push(['reply', html]),
    displayReplyAllForm: (html) => calls.push(['replyAll', html])
  };
}

function composeItem(calls, selection) {
  return {
    subject: { getAsync: (cb) => cb(Object.assign({ value: 'Re: Backup job failed' }, OK)) },
    getSelectedDataAsync: (type, cb) => cb(Object.assign({ value: { data: selection } }, OK)),
    body: {
      getAsync: (type, cb) => cb(Object.assign({ value: 'whole draft body' }, OK)),
      getTypeAsync: (cb) => cb(Object.assign({ value: 'html' }, OK)),
      setSelectedDataAsync: (data, opts, cb) => { calls.push(['insert', data, opts.coercionType]); cb(OK); },
      setAsync: (data, opts, cb) => { calls.push(['setBody', data, opts.coercionType]); cb(OK); }
    }
  };
}

// api: { status, body } or a function(sentBody) returning one; null = never answers
function mount({ item, settings, api }) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const w = dom.window;
  const requests = [];
  w.XMLHttpRequest = function () {
    const x = this;
    x.headers = {};
    x.open = (m, u) => { x.url = u; };
    x.setRequestHeader = (k, v) => { x.headers[k] = v; };
    x.abort = () => { x.aborted = true; x.readyState = 4; x.status = 0; x.onreadystatechange(); };
    x.send = (b) => {
      const sent = JSON.parse(b);
      requests.push({ headers: x.headers, body: sent });
      if (api === null) return;
      const r = typeof api === 'function' ? api(sent) : api;
      setTimeout(() => { x.readyState = 4; x.status = r.status; x.responseText = r.body; x.onreadystatechange(); }, 1);
    };
  };
  w.Office = {
    CoercionType: { Text: 'text', Html: 'html' },
    AsyncResultStatus: { Succeeded: 'succeeded', Failed: 'failed' },
    EventType: { ItemChanged: 'olkItemSelectedChanged' },
    context: { roamingSettings: settings, mailbox: { item, addHandlerAsync: () => {} } },
    onReady: (cb) => cb({ host: 'Outlook' })
  };
  w.document.execCommand = () => true;
  for (const f of ['prompts.js', 'claude.js', 'taskpane.js']) w.eval(read(f));
  const $ = (id) => w.document.getElementById(id);
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const btn = (action) => w.document.querySelector(`button[data-action="${action}"]`);
  const visible = (id) => $(id).style.display !== 'none';
  return { w, $, click, btn, visible, requests };
}

const reply = (text) => ({ status: 200, body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
const KEY = { apiKey: 'sk-ant-api03-test-9f3c' };

test('first run opens settings and asks for a key', () => {
  const p = mount({ item: readItem([]), settings: roaming({}), api: reply('x') });
  assert.ok(p.visible('settings'));
  assert.match(p.$('status').textContent, /paste your Anthropic API key/i);
  assert.strictEqual(p.$('mode').textContent, 'Reading');
  assert.ok(p.visible('read-actions') && !p.visible('compose-actions'));
});

test('saving a key stores it and closes settings; bad keys are refused', () => {
  const s = roaming({});
  const p = mount({ item: readItem([]), settings: s, api: reply('x') });
  p.$('apiKey').value = 'not-a-key';
  p.click(p.$('save-settings'));
  assert.strictEqual(s.data.apiKey, undefined);
  assert.match(p.$('status').textContent, /doesn't look like/);
  p.$('apiKey').value = '  sk-ant-api03-abcd1234  ';
  p.$('model').value = 'claude-sonnet-5-5';
  p.$('context').value = 'MSP engineer';
  p.click(p.$('save-settings'));
  assert.deepStrictEqual(s.data, { apiKey: 'sk-ant-api03-abcd1234', model: 'claude-sonnet-5-5', context: 'MSP engineer' });
  assert.ok(!p.visible('settings'));
  p.click(p.$('open-settings'));
  assert.strictEqual(p.$('apiKey').value, '', 'saved key is never written back into the field');
  assert.match(p.$('apiKey').placeholder, /ends 1234/);
});

test('running without a key asks for one and sends nothing', () => {
  const p = mount({ item: readItem([]), settings: roaming({}), api: reply('x') });
  p.click(p.$('open-settings'));
  assert.ok(!p.visible('settings'));
  p.click(p.btn('summarize'));
  assert.strictEqual(p.requests.length, 0);
  assert.ok(p.visible('settings'), 'settings reopen');
  assert.strictEqual(p.$('status').textContent, 'Paste your Anthropic API key first.');
  assert.ok(!p.btn('summarize').disabled);
});

test('read mode: draft reply, then open it as a reply', async () => {
  const calls = [];
  const p = mount({ item: readItem(calls), settings: roaming(Object.assign({ context: 'Sign off: Keith' }, KEY)), api: reply('Hi Dana,\n\nOn it <now> & will report.') });
  p.$('extra').value = 'tell her I am on it';
  p.click(p.btn('reply'));
  assert.ok(p.btn('reply').disabled, 'buttons lock while working');
  await tick();
  const req = p.requests[0];
  assert.strictEqual(req.headers['x-api-key'], KEY.apiKey);
  assert.strictEqual(req.body.model, 'claude-opus-5-5');
  assert.match(req.body.system, /About the user: Sign off: Keith/);
  assert.match(req.body.messages[0].content, /Subject: Backup job failed/);
  assert.match(req.body.messages[0].content, /Veeam job failed twice overnight\./);
  assert.match(req.body.messages[0].content, /tell her I am on it/);
  assert.ok(!p.btn('reply').disabled);
  assert.match(p.$('output').textContent, /On it <now> & will report\./);
  assert.ok(p.visible('use-reply') && p.visible('use-replyall') && !p.visible('use-insert') && !p.visible('use-body'));
  p.click(p.$('use-reply'));
  assert.deepStrictEqual(calls[0], ['reply', '<p>Hi Dana,</p><p>On it &lt;now&gt; &amp; will report.</p>']);
  p.click(p.$('use-replyall'));
  assert.strictEqual(calls[1][0], 'replyAll');
});

test('API errors show in the status line', async () => {
  const p = mount({ item: readItem([]), settings: roaming(KEY), api: { status: 401, body: '{"error":{"message":"invalid x-api-key"}}' } });
  p.click(p.btn('summarize'));
  await tick();
  assert.match(p.$('status').textContent, /key was rejected/);
  assert.ok(!p.visible('output-wrap'));
  assert.ok(!p.btn('summarize').disabled);
});

test('cancel stops a request in flight', async () => {
  const p = mount({ item: readItem([]), settings: roaming(KEY), api: null });
  p.click(p.btn('summarize'));
  assert.ok(p.visible('cancel'));
  p.click(p.$('cancel'));
  await tick();
  assert.strictEqual(p.$('status').textContent, 'Cancelled.');
  assert.ok(!p.visible('cancel'));
});

test('compose mode works on the selection and replaces it', async () => {
  const calls = [];
  const p = mount({ item: composeItem(calls, 'pls fix asap thx'), settings: roaming(KEY), api: reply('Could you fix this today?\nThanks.') });
  assert.strictEqual(p.$('mode').textContent, 'Composing');
  assert.ok(p.visible('compose-actions') && !p.visible('read-actions'));
  p.click(p.btn('professional'));
  await tick();
  const content = p.requests[0].body.messages[0].content;
  assert.match(content, /<text>\npls fix asap thx\n<\/text>/);
  assert.ok(!/whole draft body/.test(content));
  assert.match(content, /Subject of this email: Re: Backup job failed/);
  assert.strictEqual(p.$('use-insert').textContent, 'Replace selection');
  assert.ok(!p.visible('use-reply'));
  p.click(p.$('use-insert'));
  assert.deepStrictEqual(calls[0], ['insert', '<p>Could you fix this today?<br>Thanks.</p>', 'html']);
});

test('compose mode with no selection uses the whole body and can replace it', async () => {
  const calls = [];
  const p = mount({ item: composeItem(calls, ''), settings: roaming(KEY), api: reply('Clean draft.') });
  p.click(p.btn('improve'));
  await tick();
  assert.match(p.requests[0].body.messages[0].content, /whole draft body/);
  assert.strictEqual(p.$('use-insert').textContent, 'Insert at cursor');
  p.click(p.$('use-body'));
  assert.deepStrictEqual(calls[0], ['setBody', '<p>Clean draft.</p>', 'html']);
});

test('"Ask / Do it" with no instruction sends nothing', () => {
  const p = mount({ item: composeItem([], 'text'), settings: roaming(KEY), api: reply('x') });
  p.click(p.btn('ask'));
  assert.strictEqual(p.requests.length, 0);
  assert.match(p.$('status').textContent, /Type an instruction first/);
});
