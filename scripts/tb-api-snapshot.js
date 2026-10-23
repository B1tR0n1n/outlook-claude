#!/usr/bin/env node
// Condense Thunderbird's annotated WebExtension schemas into thunderbird/test/tb-api.json, which
// the tests check every manifest key, permission and messenger.* call against.
//   git clone -b esr-mv3 https://github.com/thunderbird/webext-annotated-schemas /tmp/tbs
//   node scripts/tb-api-snapshot.js /tmp/tbs/schema-files
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: tb-api-snapshot.js <schema-files dir>'); process.exit(2); }

const added = (o) => ((o.annotations || []).find((a) => a.version_added) || {}).version_added || null;
const out = { source: 'thunderbird/webext-annotated-schemas esr-mv3', namespaces: {}, manifestKeys: [], permissions: [] };

for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  for (const ns of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
    for (const t of ns.types || []) {
      if (t.$extend === 'WebExtensionManifest' || t.id === 'WebExtensionManifest') out.manifestKeys.push(...Object.keys(t.properties || {}));
      if (/Permission/.test(t.$extend || t.id || '')) {
        for (const c of t.choices || [t]) out.permissions.push(...(c.enum || []));
      }
    }
    if (!ns.functions && !ns.events) continue;
    const entry = out.namespaces[ns.namespace] || (out.namespaces[ns.namespace] = { permissions: ns.permissions || [], members: {} });
    for (const fn of ns.functions || []) {
      entry.members[fn.name] = {
        kind: 'function',
        added: added(fn),
        params: (fn.parameters || []).filter((p) => p.type !== 'function').map((p) => p.name + (p.optional ? '?' : ''))
      };
    }
    for (const ev of ns.events || []) entry.members[ev.name] = { kind: 'event', added: added(ev) };
  }
}
out.manifestKeys = [...new Set(out.manifestKeys)].sort();
out.permissions = [...new Set(out.permissions)].sort();
const dest = path.join(__dirname, '..', 'thunderbird', 'test', 'tb-api.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log('wrote ' + dest + ': ' + Object.keys(out.namespaces).length + ' namespaces');
