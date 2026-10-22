const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../src/prompts.js');

const msg = {
  subject: 'VPN down at Site B',
  from: { displayName: 'Dana Ops', emailAddress: 'dana@client.example' },
  to: [{ displayName: 'Keith', emailAddress: 'keith@msp.example' }],
  cc: [{ emailAddress: 'noc@msp.example' }],
  date: 'Wed Oct 22 2026',
  body: 'Tunnel dropped at 06:10. Can you look before 9?'
};

test('read prompt carries headers and body', () => {
  const p = P.buildRead('summarize', msg);
  assert.match(p, /Subject: VPN down at Site B/);
  assert.match(p, /From: Dana Ops <dana@client\.example>/);
  assert.match(p, /To: Keith <keith@msp\.example>/);
  assert.match(p, /Cc: noc@msp\.example/);
  assert.match(p, /Tunnel dropped at 06:10/);
  assert.match(p, /Summarize/);
});

test('reply instructions are appended', () => {
  assert.match(P.buildRead('reply', msg, 'say I am on it'), /The user's instructions: say I am on it/);
});

test('ask needs a question', () => {
  assert.throws(() => P.buildRead('ask', msg, ''), /Type a question/);
  assert.match(P.buildRead('ask', msg, 'Who owns the firewall?'), /Who owns the firewall\?$/);
});

test('unknown actions are rejected', () => {
  assert.throws(() => P.buildRead('nope', msg), /Unknown action/);
  assert.throws(() => P.buildCompose('nope', 'text'), /Unknown action/);
});

test('compose prompt wraps the text and subject', () => {
  const p = P.buildCompose('shorten', 'Long draft here.', '', { subject: 'Re: VPN' });
  assert.match(p, /Subject of this email: Re: VPN/);
  assert.match(p, /<text>\nLong draft here\.\n<\/text>/);
  assert.match(p, /half the length/);
});

test('compose refuses empty text and empty instruction', () => {
  assert.throws(() => P.buildCompose('improve', '   '), /no text/);
  assert.throws(() => P.buildCompose('ask', 'draft', ''), /Type an instruction/);
});

test('huge bodies are clipped', () => {
  const p = P.buildRead('summarize', Object.assign({}, msg, { body: 'x'.repeat(P.MAX_BODY_CHARS + 500) }));
  assert.match(p, /truncated/);
  assert.ok(p.length < P.MAX_BODY_CHARS + 1000);
});

test('system prompt adds user context only when given', () => {
  assert.ok(!/About the user/.test(P.system('')));
  assert.match(P.system('  MSP engineer. Sign off: Keith '), /About the user: MSP engineer\. Sign off: Keith$/);
  assert.match(P.system(''), /plain text only/);
});

test('textToHtml escapes and builds paragraphs', () => {
  assert.strictEqual(
    P.textToHtml('Hi <Dana> & team,\n\nLine one\nline two\n\n\n'),
    '<p>Hi &lt;Dana&gt; &amp; team,</p><p>Line one<br>line two</p>'
  );
  assert.strictEqual(P.textToHtml(''), '');
});
