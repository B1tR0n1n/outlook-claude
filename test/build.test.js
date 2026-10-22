// Every URL the built manifest points at must be a file in docs/, or Outlook gets a 404.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BASE = 'https://example.test/addin';

test('every manifest URL resolves to a built file', () => {
  execFileSync(path.join(ROOT, 'build.sh'), { env: Object.assign({}, process.env, { BASE_URL: BASE }), stdio: 'ignore' });
  try {
    const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'manifest.xml'), 'utf8');
    assert.ok(!/\{\{BASE\}\}/.test(manifest), 'template placeholder left in manifest');
    const urls = manifest.match(/https:\/\/example\.test\/addin[^"\s<]*/g);
    assert.ok(urls.length >= 8);
    for (const u of urls) {
      let rel = u.slice(BASE.length).replace(/^\//, '');
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      assert.ok(fs.existsSync(path.join(ROOT, 'docs', rel)), `manifest points at missing file: ${u}`);
    }
  } finally {
    execFileSync(path.join(ROOT, 'build.sh'), { stdio: 'ignore' }); // restore the real build
  }
});
