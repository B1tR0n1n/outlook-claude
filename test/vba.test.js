// No VBA runtime here, so check what can break an Outlook import or compile:
// encoding, line endings, header, Option Explicit, and balanced blocks.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'vba', 'ClaudeOutlook.bas');
const raw = fs.readFileSync(FILE);
const text = raw.toString('latin1');

// Logical lines: join " _" continuations, drop comments outside strings.
function logicalLines(src) {
  const joined = src.replace(/ _\r\n\s*/g, ' ');
  return joined.split('\r\n').map((l) => {
    let inStr = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"') inStr = !inStr;
      else if (l[i] === "'" && !inStr) return l.slice(0, i).trimEnd();
    }
    return l.trimEnd();
  });
}
const lines = logicalLines(text);

test('ASCII only, CRLF line endings', () => {
  assert.ok(raw.every((b) => b < 128), 'non-ASCII byte (VBA import is ANSI)');
  assert.ok(!/[^\r]\n/.test(text), 'bare LF line ending');
});

test('module header and Option Explicit', () => {
  assert.ok(text.startsWith('Attribute VB_Name = "ClaudeOutlook"\r\n'));
  assert.ok(lines.includes('Option Explicit'));
});

test('blocks are balanced', () => {
  const stack = [];
  const open = (kind, n) => stack.push([kind, n]);
  const close = (kind, n) => {
    const top = stack.pop();
    assert.ok(top && top[0] === kind, `line ${n}: closes ${kind} but open block is ${top && top[0]} (line ${top && top[1]})`);
  };
  lines.forEach((l, i) => {
    const n = i + 1;
    const s = l.trim();
    if (/^(Public |Private )?Sub \w+/.test(s)) open('Sub', n);
    else if (/^(Public |Private )?Function \w+/.test(s)) open('Function', n);
    else if (/^End Sub$/.test(s)) close('Sub', n);
    else if (/^End Function$/.test(s)) close('Function', n);
    else if (/^Select Case /.test(s)) open('Select', n);
    else if (/^End Select$/.test(s)) close('Select', n);
    else if (/^Do( While| Until|$)/.test(s)) open('Do', n);
    else if (/^Loop\b/.test(s)) close('Do', n);
    else if (/^For /.test(s)) open('For', n);
    else if (/^Next\b/.test(s)) close('For', n);
    else if (/^If .* Then$/.test(s)) open('If', n);
    else if (/^End If$/.test(s)) close('If', n);
  });
  assert.deepStrictEqual(stack, [], 'unclosed blocks');
});

test('every public macro the README lists exists', () => {
  const macros = ['Claude_Summarize', 'Claude_ActionItems', 'Claude_DraftReply', 'Claude_DraftReplyAll', 'Claude_Ask',
    'Claude_Improve', 'Claude_Shorten', 'Claude_Professional', 'Claude_Friendlier', 'Claude_NotesToEmail', 'Claude_DoIt',
    'Claude_SetKey', 'Claude_SetAboutMe', 'Claude_SetModel'];
  for (const m of macros) assert.ok(lines.includes(`Public Sub ${m}()`), `missing ${m}`);
});

test('uses the same API contract as the add-in', () => {
  assert.match(text, /"https:\/\/api\.anthropic\.com\/v1\/messages"/);
  assert.match(text, /"anthropic-version", API_VERSION/);
  assert.match(text, /API_VERSION As String = "2023-06-01"/);
  assert.match(text, /"x-api-key", apiKey/);
});
