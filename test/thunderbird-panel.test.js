// Drives the real Thunderbird panel in jsdom against a fake messenger API and a fake Claude API.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('thunderbird/panel.html').replace(/<script[\s\S]*?<\/script>/g, '');
const SCRIPTS = ['src/prompts.js', 'src/claude.js', 'thunderbird/mail.js', 'thunderbird/panel.js'].map(read);
const tick = () => new Promise((r) => setTimeout(r, 20));
const KEY = { apiKey: 'sk-ant-api03-test-9f3c' };

const HEADER = {
  id: 42, subject: 'Backup job failed', author: 'Dana <dana@client.example>',
  recipients: ['Keith <keith@msp.example>'], ccList: [], date: new Date('2026-10-22T08:00:00Z')
};
const PARTS = [{ contentType: 'text/plain', content: 'Veeam job failed twice overnight.' }];
const DRAFT = '<html><body>pls fix asap thx<div class="moz-cite-prefix">Dana wrote:</div>' +
  '<blockquote type="cite">Veeam failed.</blockquote></body></html>';
const FRESH_REPLY = '<html><body><p><br></p><div class="moz-cite-prefix">Dana wrote:</div><blockquote type="cite">q</blockquote></body></html>';

// opts: tabType, displayed, parts, draft (compose details for tab 7), selection, composeScript, storage
function fakeMessenger(opts) {
  const calls = [];
  const store = Object.assign({}, opts.storage);
  const drafts = { 7: Object.assign({ subject: 'Re: Backup job failed', body: DRAFT, isPlainText: false }, opts.draft), 99: { body: FRESH_REPLY, isPlainText: false } };
  const api = {
    storage: { local: {
      get: async (keys) => { const o = {}; for (const k of keys) if (k in store) o[k] = store[k]; return o; },
      set: async (v) => { Object.assign(store, v); },
      remove: async (k) => { delete store[k]; }
    } },
    tabs: {
      get: async (id) => ({ id, type: id === 7 ? opts.tabType || 'messageDisplay' : 'messageCompose', windowId: 3 }),
      sendMessage: async (id, msg) => {
        calls.push(['sendMessage', id, msg]);
        if (opts.composeScript === false) throw new Error('Could not establish connection. Receiving end does not exist.');
        return msg.claude === 'getSelection' ? { text: opts.selection || '' } : { ok: opts.replaceOk !== false };
      }
    },
    windows: { update: async (id, info) => { calls.push(['focus', id, info]); } },
    messageDisplay: { getDisplayedMessages: async () => ({ id: 'list', messages: opts.displayed || [HEADER] }) },
    messages: { listInlineTextParts: async () => opts.parts || PARTS },
    messengerUtilities: opts.utilities,
    compose: {
      getComposeDetails: async (id) => Object.assign({}, drafts[id]),
      setComposeDetails: async (id, d) => { calls.push(['set', id, d]); Object.assign(drafts[id], d); },
      beginReply: async (id, type) => { calls.push(['beginReply', id, type]); return { id: 99, type: 'messageCompose' }; }
    }
  };
  return { api, calls, store, drafts };
}

// api: { status, body } or a function(sentBody) returning one; null = never answers
async function mount(opts, apiReply, tab = 7) {
  const dom = new JSDOM(HTML, { url: 'moz-extension://claude/panel.html' + (tab ? '?tab=' + tab : ''), runScripts: 'outside-only' });
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
      requests.push({ url: x.url, headers: x.headers, body: sent });
      if (apiReply === null) return;
      const r = typeof apiReply === 'function' ? apiReply(sent) : apiReply;
      setTimeout(() => { x.readyState = 4; x.status = r.status; x.responseText = r.body; x.onreadystatechange(); }, 1);
    };
  };
  const tb = fakeMessenger(opts);
  w.messenger = tb.api;
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } } });
  for (const s of SCRIPTS) w.eval(s);
  await w.ClaudePanel.ready;
  const $ = (id) => w.document.getElementById(id);
  const click = async (el) => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await tick(); };
  const btn = (action) => w.document.querySelector(`button[data-action="${action}"]`);
  const visible = (id) => $(id).style.display !== 'none';
  return { w, $, click, btn, visible, requests, tb, copied };
}

const reply = (text) => ({ status: 200, body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
// Objects built inside the jsdom window have that window's prototypes.
const plain = (v) => JSON.parse(JSON.stringify(v));
const bodyOf = (html) => new JSDOM(html).window.document.body;

test('first run opens settings and asks for a key', async () => {
  const p = await mount({}, reply('x'));
  assert.ok(p.visible('settings'));
  assert.match(p.$('status').textContent, /paste your Anthropic API key/i);
  assert.strictEqual(p.$('mode').textContent, 'Reading');
  assert.ok(p.visible('read-actions') && !p.visible('compose-actions'));
});

test('opened with no tab it is the settings page only', async () => {
  const p = await mount({}, reply('x'), 0);
  assert.strictEqual(p.$('mode').textContent, 'Settings');
  assert.ok(p.visible('settings'));
  assert.ok(!p.visible('read-actions') && !p.visible('compose-actions') && !p.visible('ask-box'));
  assert.strictEqual(p.$('model').options.length, 3);
});

test('saving a key stores it, admin and foreign keys are refused, the key is never shown back', async () => {
  const p = await mount({}, reply('x'));
  p.$('apiKey').value = 'sk-ant-admin01-xyz';
  await p.click(p.$('save-settings'));
  assert.strictEqual(p.tb.store.apiKey, undefined);
  assert.match(p.$('status').textContent, /Admin key/);
  p.$('apiKey').value = 'not-a-key';
  await p.click(p.$('save-settings'));
  assert.match(p.$('status').textContent, /doesn't look like/);
  p.$('apiKey').value = '  sk-ant-api03-abcd1234  ';
  p.$('model').value = 'claude-sonnet-5-5';
  p.$('context').value = 'MSP engineer';
  await p.click(p.$('save-settings'));
  assert.deepStrictEqual(p.tb.store, { apiKey: 'sk-ant-api03-abcd1234', model: 'claude-sonnet-5-5', context: 'MSP engineer' });
  assert.ok(!p.visible('settings'));
  await p.click(p.$('open-settings'));
  assert.strictEqual(p.$('apiKey').value, '');
  assert.match(p.$('apiKey').placeholder, /ends 1234/);
  await p.click(p.$('clear-key'));
  assert.strictEqual(p.tb.store.apiKey, undefined);
  assert.strictEqual(p.tb.store.model, 'claude-sonnet-5-5');
});

test('running without a key reopens settings and sends nothing', async () => {
  const p = await mount({}, reply('x'));
  await p.click(p.$('open-settings'));
  await p.click(p.btn('summarize'));
  assert.strictEqual(p.requests.length, 0);
  assert.ok(p.visible('settings'));
  assert.strictEqual(p.$('status').textContent, 'Paste your Anthropic API key first.');
});

test('read mode: draft a reply, open it above the quote of a real reply', async () => {
  const p = await mount({ storage: Object.assign({ context: 'Sign off: Keith' }, KEY) }, reply('Hi Dana,\n\nOn it <now> & will report.'));
  p.$('extra').value = 'tell her I am on it';
  await p.click(p.btn('reply'));
  const req = p.requests[0];
  assert.strictEqual(req.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(req.headers['x-api-key'], KEY.apiKey);
  assert.strictEqual(req.body.model, 'claude-opus-5-5');
  assert.match(req.body.system, /inside Thunderbird/);
  assert.match(req.body.system, /About the user: Sign off: Keith/);
  const content = req.body.messages[0].content;
  assert.match(content, /Subject: Backup job failed/);
  assert.match(content, /From: Dana <dana@client\.example>/);
  assert.match(content, /Veeam job failed twice overnight\./);
  assert.match(content, /tell her I am on it/);
  assert.ok(!p.btn('reply').disabled);
  assert.strictEqual(p.$('output').value, 'Hi Dana,\n\nOn it <now> & will report.');
  assert.ok(p.visible('use-reply') && p.visible('use-replyall') && !p.visible('use-own') && !p.visible('use-selection'));

  p.$('output').value = 'Hi Dana,\n\nOn it <now>.'; // edited before use
  await p.click(p.$('use-reply'));
  assert.deepStrictEqual(p.tb.calls[0], ['beginReply', 42, 'replyToSender']);
  const set = p.tb.calls[1];
  assert.strictEqual(set[0], 'set');
  assert.strictEqual(set[1], 99);
  const b = bodyOf(set[2].body);
  assert.strictEqual(b.firstChild.outerHTML, '<p>Hi Dana,</p>');
  assert.strictEqual(b.children[1].outerHTML, '<p>On it &lt;now&gt;.</p>');
  assert.strictEqual(b.querySelector('blockquote').textContent, 'q');
  assert.match(p.$('status').textContent, /Reply opened/);

  await p.click(p.$('use-replyall'));
  assert.deepStrictEqual(p.tb.calls[2], ['beginReply', 42, 'replyToAll']);
});

test('read mode: HTML-only mail is converted with Thunderbird, or the DOM when that API is missing', async () => {
  const parts = [{ contentType: 'text/html', content: '<p>Server <b>down</b></p>' }];
  const p = await mount({ storage: KEY, parts, utilities: { convertToPlainText: async () => 'Server down (tb)' } }, reply('ok'));
  await p.click(p.btn('summarize'));
  assert.match(p.requests[0].body.messages[0].content, /Server down \(tb\)/);

  const q = await mount({ storage: KEY, parts }, reply('ok'));
  await q.click(q.btn('summarize'));
  assert.match(q.requests[0].body.messages[0].content, /\nServer down\n/);
});

test('read mode: no message open, or several selected', async () => {
  const p = await mount({ storage: KEY, displayed: [] }, reply('x'));
  await p.click(p.btn('summarize'));
  assert.strictEqual(p.requests.length, 0);
  assert.match(p.$('status').textContent, /No email is open/);
  assert.ok(!p.btn('summarize').disabled);

  const q = await mount({ storage: KEY, displayed: [HEADER, Object.assign({}, HEADER, { id: 43 })] }, reply('Three bullets.'));
  await q.click(q.btn('summarize'));
  assert.match(q.$('status').textContent, /Several emails selected; used the first\. Done\./);
});

test('API errors show in the status line and nothing is written', async () => {
  const p = await mount({ storage: KEY }, { status: 401, body: '{"error":{"message":"invalid x-api-key"}}' });
  await p.click(p.btn('summarize'));
  assert.match(p.$('status').textContent, /key was rejected/);
  assert.ok(!p.visible('output-wrap'));
  assert.ok(!p.btn('summarize').disabled);
  assert.strictEqual(p.tb.calls.length, 0);
});

test('cancel stops a request in flight and shows the elapsed timer meanwhile', async () => {
  const p = await mount({ storage: KEY }, null);
  await p.click(p.btn('summarize'));
  assert.match(p.$('status').textContent, /Claude is working \(claude-opus-5-5\)\.\.\. \d+s/);
  assert.ok(p.visible('cancel') && p.btn('summarize').disabled);
  await p.click(p.$('cancel'));
  assert.strictEqual(p.$('status').textContent, 'Cancelled.');
  assert.ok(!p.visible('cancel') && !p.btn('summarize').disabled);
});

test('compose mode works on the selection and replaces it in the draft window', async () => {
  const p = await mount({ storage: KEY, tabType: 'messageCompose', selection: 'pls fix asap thx' }, reply('Could you fix this today?\nThanks.'));
  assert.strictEqual(p.$('mode').textContent, 'Composing');
  assert.ok(p.visible('compose-actions') && !p.visible('read-actions'));
  await p.click(p.btn('professional'));
  const content = p.requests[0].body.messages[0].content;
  assert.match(content, /<text>\npls fix asap thx\n<\/text>/);
  assert.match(content, /Subject of this email: Re: Backup job failed/);
  assert.ok(!/Veeam/.test(content), 'the quote is not sent when there is a selection');
  assert.ok(p.visible('use-selection') && p.visible('use-own') && !p.visible('use-reply'));
  await p.click(p.$('use-selection'));
  assert.deepStrictEqual(plain(p.tb.calls.slice(-2)), [
    ['focus', 3, { focused: true }],
    ['sendMessage', 7, { claude: 'replaceSelection', html: '<p>Could you fix this today?<br>Thanks.</p>' }]
  ]);
  assert.match(p.$('status').textContent, /Selection replaced/);
});

test('compose mode with no selection rewrites only the user text and keeps the quote', async () => {
  const p = await mount({ storage: KEY, tabType: 'messageCompose', selection: '' }, reply('Could you fix this today?'));
  await p.click(p.btn('improve'));
  const content = p.requests[0].body.messages[0].content;
  assert.match(content, /<text>\npls fix asap thx\n<\/text>/);
  assert.ok(!/Veeam/.test(content));
  assert.ok(!p.visible('use-selection') && p.visible('use-own'));
  await p.click(p.$('use-own'));
  const b = bodyOf(p.tb.drafts[7].body);
  assert.strictEqual(b.firstChild.outerHTML, '<p>Could you fix this today?</p>');
  assert.strictEqual(b.querySelector('blockquote').textContent, 'Veeam failed.');
  assert.match(p.$('status').textContent, /quote and signature are untouched/);
});

test('compose windows without the helper script fall back to the draft', async () => {
  const p = await mount({ storage: KEY, tabType: 'messageCompose', composeScript: false }, reply('Better.'));
  await p.click(p.btn('shorten'));
  assert.match(p.requests[0].body.messages[0].content, /pls fix asap thx/);
  assert.ok(!p.visible('use-selection'));
});

test('plain-text drafts: selection uses insertText, replace keeps the quote', async () => {
  const draft = { isPlainText: true, body: '', plainTextBody: 'pls fix\n\nDana wrote:\n> Veeam failed.' };
  const p = await mount({ storage: KEY, tabType: 'messageCompose', draft, selection: 'pls fix' }, reply('Please fix it.'));
  await p.click(p.btn('improve'));
  await p.click(p.$('use-selection'));
  assert.deepStrictEqual(plain(p.tb.calls.at(-1)), ['sendMessage', 7, { claude: 'replaceSelection', text: 'Please fix it.' }]);
  await p.click(p.$('use-own'));
  assert.strictEqual(p.tb.drafts[7].plainTextBody, 'Please fix it.\n\nDana wrote:\n> Veeam failed.');
});

test('a lost selection says so instead of pretending', async () => {
  const p = await mount({ storage: KEY, tabType: 'messageCompose', selection: 'x', replaceOk: false }, reply('y'));
  await p.click(p.btn('improve'));
  await p.click(p.$('use-selection'));
  assert.match(p.$('status').textContent, /selection is gone/);
  assert.strictEqual(p.$('status').className, 'status error');
});

test('copy puts the (edited) result on the clipboard', async () => {
  const p = await mount({ storage: KEY }, reply('three bullets'));
  await p.click(p.btn('summarize'));
  p.$('output').value = 'two bullets';
  await p.click(p.$('use-copy'));
  assert.deepStrictEqual(p.copied, ['two bullets']);
});

test('"Ask / Do it" with no instruction sends nothing', async () => {
  const p = await mount({ storage: KEY, tabType: 'messageCompose' }, reply('x'));
  await p.click(p.btn('ask'));
  assert.strictEqual(p.requests.length, 0);
  assert.match(p.$('status').textContent, /Type an instruction first/);
  const q = await mount({ storage: KEY }, reply('x'));
  await q.click(q.btn('ask'));
  assert.match(q.$('status').textContent, /Type a question first/);
});

test('a Thunderbird API failure on write-back lands in the status line', async () => {
  const p = await mount({ storage: KEY }, reply('draft'));
  await p.click(p.btn('reply'));
  p.tb.api.compose.beginReply = async () => { throw new Error('Message not found'); };
  await p.click(p.$('use-reply'));
  assert.strictEqual(p.$('status').textContent, 'Message not found');
  assert.strictEqual(p.$('status').className, 'status error');
});
