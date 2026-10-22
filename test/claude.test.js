const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../src/claude.js');

function fakeXhr(status, body) {
  const x = {
    headers: {}, sent: null, readyState: 0, status: 0, responseText: '',
    open(method, url, async) { x.method = method; x.url = url; x.async = async; },
    setRequestHeader(k, v) { x.headers[k] = v; },
    send(b) { x.sent = JSON.parse(b); x.readyState = 4; x.status = status; x.responseText = body; x.onreadystatechange(); },
    abort() {}
  };
  return x;
}

const ok = JSON.stringify({ content: [{ type: 'text', text: '  Hello ' }, { type: 'text', text: 'there' }], stop_reason: 'end_turn' });

test('sends a correct Messages API request', () => {
  let xhr;
  let out;
  C.send({ apiKey: 'sk-ant-k', system: 'SYS', prompt: 'PROMPT' }, (r) => { out = r; }, () => (xhr = fakeXhr(200, ok)));
  assert.strictEqual(xhr.method, 'POST');
  assert.strictEqual(xhr.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(xhr.async, true);
  assert.strictEqual(xhr.headers['x-api-key'], 'sk-ant-k');
  assert.strictEqual(xhr.headers['anthropic-version'], '2023-06-01');
  assert.strictEqual(xhr.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(xhr.sent.model, C.DEFAULT_MODEL);
  assert.strictEqual(xhr.sent.system, 'SYS');
  assert.deepStrictEqual(xhr.sent.messages, [{ role: 'user', content: 'PROMPT' }]);
  assert.ok(xhr.sent.max_tokens > 0);
  assert.deepStrictEqual(out, { text: 'Hello there' });
});

test('no key fails fast without a request', () => {
  let made = false;
  let out;
  C.send({ apiKey: '' }, (r) => { out = r; }, () => { made = true; });
  assert.strictEqual(made, false);
  assert.match(out.error, /No API key/);
});

test('errors map to plain messages', () => {
  assert.match(C.parseResponse(401, '{}').error, /key was rejected/);
  assert.match(C.parseResponse(0, '').error, /Could not reach/);
  assert.match(C.parseResponse(429, JSON.stringify({ error: { message: 'credit balance too low' } })).error, /credit balance too low/);
  assert.match(C.parseResponse(404, JSON.stringify({ error: { message: 'model: x' } })).error, /Model not found: model: x/);
  assert.match(C.parseResponse(529, '').error, /Anthropic API error 529/);
  assert.match(C.parseResponse(200, 'not json').error, /Unreadable/);
});

test('empty and truncated responses are flagged', () => {
  assert.match(C.parseResponse(200, JSON.stringify({ content: [], stop_reason: 'refusal' })).error, /no text \(refusal\)/);
  assert.match(C.parseResponse(200, JSON.stringify({ content: [{ type: 'text', text: 'a' }], stop_reason: 'max_tokens' })).text, /cut off/);
});

test('callback fires once even if timeout follows completion', () => {
  let calls = 0;
  let xhr;
  C.send({ apiKey: 'k', prompt: 'p' }, () => { calls++; }, () => (xhr = fakeXhr(200, ok)));
  xhr.ontimeout();
  assert.strictEqual(calls, 1);
});

test('models are the current Claude family', () => {
  assert.deepStrictEqual(C.MODELS.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
});
