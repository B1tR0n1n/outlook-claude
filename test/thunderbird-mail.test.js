// Thunderbird draft and message helpers, against the HTML Thunderbird itself writes.
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const M = require('../thunderbird/mail.js');

const parser = new (new JSDOM('').window.DOMParser)();
const body = (html) => parser.parseFromString(html, 'text/html').body;

// A Thunderbird HTML reply: the user's text, the cite line, the quote, then a signature.
const REPLY = '<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body>' +
  'pls fix asap<br>thx<br><p><br></p>' +
  '<div class="moz-cite-prefix">On 10/22/26 8:00 AM, Dana wrote:<br></div>' +
  '<blockquote type="cite"><p>Veeam failed twice.</p></blockquote>' +
  '<div class="moz-signature">-- <br>Keith</div></body></html>';

test('emailInfo maps a Thunderbird header onto the prompt shape', () => {
  const info = M.emailInfo({
    subject: 'Backup job failed', author: 'Dana <dana@client.example>',
    recipients: ['Keith <keith@msp.example>'], ccList: ['ops@msp.example'], date: new Date('2026-10-22T08:00:00Z')
  }, 'Veeam failed.');
  assert.strictEqual(info.from.displayName, 'Dana <dana@client.example>');
  assert.deepStrictEqual(info.to, [{ displayName: 'Keith <keith@msp.example>' }]);
  assert.deepStrictEqual(info.cc, [{ displayName: 'ops@msp.example' }]);
  assert.match(info.date, /2026/);
  assert.strictEqual(info.body, 'Veeam failed.');
  assert.deepStrictEqual(M.emailInfo(null, null), { subject: '', from: null, to: [], cc: [], date: '', body: '' });
});

test('pickText prefers plain parts, falls back to HTML, skips empty parts', () => {
  const parts = [
    { contentType: 'text/html', content: '<p>hi</p>' },
    { contentType: 'text/plain; charset=utf-8', content: 'hi' },
    { contentType: 'text/plain', content: '  ' },
    { contentType: 'TEXT/PLAIN', content: 'forwarded part' }
  ];
  assert.deepStrictEqual(M.pickText(parts), { type: 'plain', content: 'hi\n\nforwarded part' });
  assert.deepStrictEqual(M.pickText([{ contentType: 'text/html', content: '<b>x</b>' }]), { type: 'html', content: '<b>x</b>' });
  assert.strictEqual(M.pickText([]), null);
  assert.strictEqual(M.pickText(undefined), null);
});

test('htmlToText keeps line and paragraph breaks, drops styles and scripts', () => {
  const html = '<html><head><style>p{}</style></head><body><p>Hi Dana,</p>\n  <p>Line one<br>line&nbsp;two</p>' +
    '<ul><li>a</li><li>b</li></ul><script>x()</script><div>end</div></body></html>';
  assert.strictEqual(M.htmlToText(html, parser), 'Hi Dana,\n\nLine one\nline two\n\na\nb\nend');
  assert.strictEqual(M.htmlToText('', parser), '');
});

test('splitDraftHtml takes only the text above the quote', () => {
  const s = M.splitDraftHtml(REPLY, parser);
  assert.strictEqual(s.text, 'pls fix asap\nthx');
  assert.ok(s.boundary.matches('.moz-cite-prefix'));
});

test('splitDraftHtml stops at a signature in a new message, and at a wrapper holding the quote', () => {
  const sig = '<html><body><p>Notes here</p><div class="moz-signature">-- <br>Keith</div></body></html>';
  assert.strictEqual(M.splitDraftHtml(sig, parser).text, 'Notes here');
  const wrapped = '<html><body>Top<div><blockquote type="cite">old</blockquote></div></body></html>';
  assert.strictEqual(M.splitDraftHtml(wrapped, parser).text, 'Top');
  const fwd = '<html><body>FYI<div class="moz-forward-container">fwd</div></body></html>';
  assert.strictEqual(M.splitDraftHtml(fwd, parser).text, 'FYI');
  assert.strictEqual(M.splitDraftHtml('<html><body>All mine</body></html>', parser).boundary, null);
});

test('replaceOwnHtml swaps the user text and keeps quote and signature intact', () => {
  const out = M.replaceOwnHtml(REPLY, 'Could you fix this today?\n\nThanks <3', parser);
  assert.match(out, /^<!DOCTYPE html>/);
  const b = body(out);
  assert.strictEqual(b.firstChild.outerHTML, '<p>Could you fix this today?</p>');
  assert.strictEqual(b.children[1].outerHTML, '<p>Thanks &lt;3</p>');
  assert.ok(b.children[2].matches('.moz-cite-prefix'));
  assert.strictEqual(b.querySelector('blockquote').textContent, 'Veeam failed twice.');
  assert.strictEqual(b.querySelector('.moz-signature').innerHTML, '-- <br>Keith');
  assert.ok(!/pls fix asap/.test(out));
  assert.match(out, /charset=UTF-8/, 'head is kept');
});

test('replaceOwnHtml on a draft with no quote replaces everything', () => {
  const b = body(M.replaceOwnHtml('<html><body>old<br>text</body></html>', 'new', parser));
  assert.strictEqual(b.innerHTML, '<p>new</p>');
});

test('insertAtStartHtml puts the draft above the quote of a fresh reply', () => {
  const fresh = '<html><body><p><br></p><div class="moz-cite-prefix">Dana wrote:</div><blockquote type="cite">q</blockquote></body></html>';
  const b = body(M.insertAtStartHtml(fresh, 'Hi Dana,\nOn it.', parser));
  assert.strictEqual(b.firstChild.outerHTML, '<p>Hi Dana,<br>On it.</p>');
  assert.strictEqual(b.querySelector('blockquote').textContent, 'q');
  assert.strictEqual(body(M.insertAtStartHtml('<html><body></body></html>', 'x', parser)).innerHTML, '<p>x</p>');
});

test('plain-text drafts split at the cite line, the signature, or a forwarded banner', () => {
  const reply = 'pls fix\nthx\n\nOn 10/22/26 8:00 AM, Dana wrote:\n> Veeam failed.\n';
  assert.deepStrictEqual(M.splitDraftPlain(reply), { own: 'pls fix\nthx', rest: 'On 10/22/26 8:00 AM, Dana wrote:\n> Veeam failed.\n' });
  assert.strictEqual(M.splitDraftPlain('notes\n-- \nKeith').own, 'notes');
  assert.strictEqual(M.splitDraftPlain('fyi\n\n-------- Forwarded Message --------\nSubject: x').own, 'fyi');
  assert.strictEqual(M.splitDraftPlain('> quoted first\nmine').own, '');
  assert.deepStrictEqual(M.splitDraftPlain('all mine\r\nhere\n\n'), { own: 'all mine\nhere', rest: '' });
  assert.strictEqual(M.splitDraftPlain(undefined).own, '');
});

test('plain-text replace and insert keep the rest of the draft', () => {
  const reply = 'pls fix\n\nDana wrote:\n> Veeam failed.';
  assert.strictEqual(M.replaceOwnPlain(reply, 'Please fix it today.'), 'Please fix it today.\n\nDana wrote:\n> Veeam failed.');
  assert.strictEqual(M.replaceOwnPlain('just mine', 'new'), 'new');
  assert.strictEqual(M.insertAtStartPlain('\nDana wrote:\n> q', 'Hi'), 'Hi\n\n\nDana wrote:\n> q');
  assert.strictEqual(M.insertAtStartPlain(undefined, 'Hi'), 'Hi\n\n');
});

test('system prompt names Thunderbird and keeps the user context', () => {
  const s = M.systemPrompt('Sign off: Keith');
  assert.match(s, /inside Thunderbird/);
  assert.ok(!/Outlook/.test(s));
  assert.match(s, /About the user: Sign off: Keith/);
});

test('keyProblem accepts Claude API keys and explains the wrong kinds', () => {
  assert.strictEqual(M.keyProblem('sk-ant-api03-abc'), null);
  assert.match(M.keyProblem(''), /Paste your Anthropic API key/);
  assert.match(M.keyProblem('sk-ant-admin01-abc'), /Admin key.*cannot call Claude/);
  assert.match(M.keyProblem('sk-proj-abc'), /doesn't look like/);
});

test('draft paragraphs match what the Outlook add-in writes', () => {
  const P = require('../src/prompts.js');
  const text = 'Hi <Dana> & co,\r\n\r\nLine one\nline two\n\n\n  \n\nEnd';
  assert.strictEqual(body(M.insertAtStartHtml('<html><body></body></html>', text, parser)).innerHTML, P.textToHtml(text));
});
