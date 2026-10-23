// Opens the Claude panel for the tab whose button was clicked, and installs the compose-window
// helper that lets the panel read and replace the selected text in a draft.
'use strict';

const COMPOSE_SCRIPT = { id: 'claude-compose', js: ['compose-script.js'] };

async function registerComposeScript() {
  const existing = await messenger.scripting.compose.getRegisteredScripts({ ids: [COMPOSE_SCRIPT.id] });
  if (!existing.length) await messenger.scripting.compose.registerScripts([COMPOSE_SCRIPT]);
}

function ensureComposeScript() {
  // Without it the panel still works, on the whole draft instead of the selection.
  return registerComposeScript().catch((e) => console.error('Claude: could not register the compose script', e));
}

function openPanel(tab) {
  return messenger.windows.create({
    type: 'popup',
    url: messenger.runtime.getURL('panel.html') + '?tab=' + tab.id,
    width: 480,
    height: 760
  });
}

messenger.runtime.onInstalled.addListener(ensureComposeScript);
messenger.runtime.onStartup.addListener(ensureComposeScript);
messenger.messageDisplayAction.onClicked.addListener(openPanel);
messenger.composeAction.onClicked.addListener(openPanel);
