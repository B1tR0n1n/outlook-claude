// Checks the extension against Thunderbird's own API schemas (condensed into thunderbird/test/tb-api.json
// by scripts/tb-api-snapshot.js): every manifest key, permission and messenger.* call must exist, be
// covered by a declared permission, and be available in the minimum Thunderbird version.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const acorn = require('acorn');

const TB = path.join(__dirname, '..', 'thunderbird');
const read = (f) => fs.readFileSync(path.join(TB, f), 'utf8');
const API = JSON.parse(read('test/tb-api.json'));
const MANIFEST = JSON.parse(read('manifest.json'));
const SCRIPTS = ['background.js', 'compose-script.js', 'mail.js', 'panel.js'];
// Keys from the base WebExtension manifest, which Thunderbird's schema files extend but do not list.
const BASE_KEYS = ['manifest_version', 'name', 'version', 'description', 'author', 'homepage_url', 'browser_specific_settings'];
// Newer than the minimum version, so the code must feature-detect them.
const GUARDED = { 'messengerUtilities.convertToPlainText': /mu && mu\.convertToPlainText/ };

const MIN = MANIFEST.browser_specific_settings.gecko.strict_min_version;
const older = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

// messenger.compose.beginReply / tb.scripting.compose.registerScripts / browser.runtime.onMessage ...
function apiCalls(code) {
  const found = new Set();
  for (const m of code.matchAll(/\b(?:messenger|browser|tb)\.([A-Za-z]+(?:\.[A-Za-z]+)+)/g)) {
    const parts = m[1].split('.');
    for (let n = parts.length - 1; n >= 1; n--) {
      const ns = parts.slice(0, n).join('.');
      if (API.namespaces[ns] || ns === 'storage.local') { found.add(ns + '.' + parts[n]); break; }
    }
  }
  return [...found].sort();
}

test('manifest keys are all known to Thunderbird', () => {
  for (const k of Object.keys(MANIFEST)) assert.ok(API.manifestKeys.includes(k) || BASE_KEYS.includes(k), 'unknown manifest key ' + k);
  assert.strictEqual(MANIFEST.manifest_version, 3);
  assert.ok(MANIFEST.background.scripts, 'Thunderbird MV3 uses background scripts, not a service worker');
});

test('declared permissions exist, and host access is only the Anthropic API', () => {
  for (const p of MANIFEST.permissions) assert.ok(API.permissions.includes(p), 'unknown permission ' + p);
  assert.deepStrictEqual(MANIFEST.host_permissions, ['https://api.anthropic.com/*']);
  assert.ok(MANIFEST.permissions.includes('sensitiveDataUpload'), 'mail goes to a remote server, so this must be declared');
});

test('every messenger.* call exists, is permitted, and is available in the minimum version', () => {
  const seen = [];
  for (const f of SCRIPTS) {
    const code = read(f);
    for (const call of apiCalls(code)) {
      seen.push(call);
      const ns = call.slice(0, call.lastIndexOf('.'));
      const member = call.slice(call.lastIndexOf('.') + 1);
      if (ns === 'storage.local') {
        assert.ok(['get', 'set', 'remove'].includes(member), call);
        assert.ok(MANIFEST.permissions.includes('storage'), call + ' needs storage');
        continue;
      }
      const info = API.namespaces[ns].members[member];
      assert.ok(info, `${f}: ${call} is not a Thunderbird API`);
      for (const perm of API.namespaces[ns].permissions) {
        if (perm.startsWith('manifest:')) assert.ok(MANIFEST[perm.slice(9)], `${call} needs manifest key ${perm.slice(9)}`);
        else assert.ok(MANIFEST.permissions.includes(perm), `${call} needs permission ${perm}`);
      }
      if (info.added && older(MIN, info.added)) {
        assert.ok(GUARDED[call] && GUARDED[call].test(code), `${f}: ${call} needs Thunderbird ${info.added} but the minimum is ${MIN}`);
      }
    }
  }
  for (const want of ['compose.beginReply', 'compose.getComposeDetails', 'compose.setComposeDetails',
    'messageDisplay.getDisplayedMessages', 'messages.listInlineTextParts', 'scripting.compose.registerScripts',
    'tabs.sendMessage', 'windows.create', 'messageDisplayAction.onClicked', 'composeAction.onClicked']) {
    assert.ok(seen.includes(want), 'expected the extension to use ' + want);
  }
});

test('reply types are the ones Thunderbird accepts', () => {
  const used = [...read('panel.js').matchAll(/'(replyTo\w+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(used.sort(), ['replyToAll', 'replyToSender']);
});

test('scripts parse as modern browser JS, with no inline handlers or remote code in the panel', () => {
  for (const f of SCRIPTS) assert.doesNotThrow(() => acorn.parse(read(f), { ecmaVersion: 2022, sourceType: 'script' }), f);
  const html = read('panel.html');
  assert.ok(!/\son[a-z]+=/i.test(html), 'inline event handlers are blocked by the extension CSP');
  assert.ok(!/<script>[^<]/.test(html), 'inline scripts are blocked by the extension CSP');
  assert.ok(!/(src|href)="https?:/.test(html), 'everything ships in the package');
  assert.ok(!/console\.log/.test(SCRIPTS.map(read).join('\n')));
});

test('every element id the panel script uses is in panel.html', () => {
  const html = read('panel.html');
  const ids = new Set([...read('panel.js').matchAll(/\$\('([\w-]+)'\)|on\('([\w-]+)'/g)].map((m) => m[1] || m[2]));
  assert.ok(ids.size > 15);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), 'panel.html has no #' + id);
});

test('the package holds every file the manifest, panel and background reference', () => {
  execFileSync(path.join(TB, 'build.sh'), { stdio: 'ignore' });
  const listing = execFileSync('python3', ['-c', 'import sys,zipfile;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
    path.join(TB, 'dist', 'claude-thunderbird.xpi')], { encoding: 'utf8' }).trim().split('\n');
  const refs = new Set([
    ...Object.values(MANIFEST.icons),
    ...Object.values(MANIFEST.message_display_action.default_icon),
    ...Object.values(MANIFEST.compose_action.default_icon),
    ...MANIFEST.background.scripts,
    MANIFEST.options_ui.page,
    ...[...read('panel.html').matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
    ...[...read('background.js').matchAll(/'([\w-]+\.(?:js|html))'/g)].map((m) => m[1])
  ]);
  for (const r of refs) assert.ok(listing.includes(r), 'missing from the .xpi: ' + r);
  assert.ok(listing.includes('manifest.json'));
});
