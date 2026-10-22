// Older classic Outlook builds host add-ins in IE11. Every shipped script must
// parse as ES5 and avoid APIs IE11 lacks.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const SRC = path.join(__dirname, '..', 'src');
const scripts = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bPromise\b/, 'Promise'],
  [/\basync\s+function\b|\bawait\b/, 'async/await'],
  [/\.includes\s*\(/, 'Array/String includes()'],
  [/\.startsWith\s*\(|\.endsWith\s*\(/, 'startsWith/endsWith'],
  [/\bObject\.assign\b/, 'Object.assign'],
  [/\.find(Index)?\s*\(/, 'Array find()'],
  [/\bnavigator\.clipboard\b/, 'navigator.clipboard'],
  [/\bclassList\b/, 'classList'],
  [/\bwindow\.(alert|confirm|prompt)\b|^\s*(alert|confirm|prompt)\s*\(/m, 'alert/confirm/prompt (blocked in add-ins)']
];

test('there are scripts to check', () => assert.ok(scripts.length >= 3));

for (const f of scripts) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  test(`${f} parses as ES5`, () => {
    assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' }));
  });
  test(`${f} uses no IE11-missing APIs`, () => {
    const stripped = code.replace(/\/\/.*$/gm, '');
    for (const [re, name] of FORBIDDEN) assert.ok(!re.test(stripped), `${f} uses ${name}`);
  });
}

test('inline script in commands.html is ES5', () => {
  const html = fs.readFileSync(path.join(SRC, 'commands.html'), 'utf8');
  const inline = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => acorn.parse(inline[1], { ecmaVersion: 5 }));
});

test('CSS uses no custom properties (IE11)', () => {
  const css = fs.readFileSync(path.join(SRC, 'taskpane.css'), 'utf8');
  assert.ok(!/var\(--|--[a-z-]+\s*:/.test(css));
});
