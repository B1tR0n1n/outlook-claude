# Claude for Outlook

A small Office.js mail add-in for **classic Outlook on Windows** against **on-prem Exchange 2016/2019** (it also works on Exchange Online and Outlook on the web). It adds a **Claude** button to the ribbon.

| Mode | What you get |
|---|---|
| Reading an email | Summarize, Action items, Draft reply (opens a real reply with the draft in it), Ask (any question about the email) |
| Composing | Improve, Shorten, Professional, Friendlier, Notes → email, Do it (any instruction). Works on the selected text, or on the whole draft if nothing is selected. |

It is personal-use only. Your Anthropic API key is stored in your mailbox's add-in settings (roaming settings), and requests go straight from Outlook to `api.anthropic.com`. There is no server in between. Everything you send leaves your network for Anthropic, so check that against client and data rules before you use it on client mail.

## Why Office.js and not COM

Classic Outlook has run Office.js mail add-ins since Outlook 2013 SP1, and on-prem Exchange has hosted them since Exchange 2013. The manifest asks for **Mailbox API 1.3**, the most that Exchange 2016/2019 on-prem supports, and the code doesn't depend on anything newer. All scripts are **ES5 with callbacks only**, because Outlook 2016/2019 (volume-licensed) runs add-ins inside Internet Explorer 11. Microsoft 365 builds use WebView2, and the same code runs there.

## Requirements

- Windows 10 or 11 with classic Outlook 2016, 2019, 2021 or Microsoft 365.
- Exchange 2016 or 2019 (or Exchange Online). Exchange 2013 lacks ribbon buttons for add-ins.
- Your mailbox must be allowed to install custom add-ins: the Exchange role **My Custom Apps**, which the default role assignment policy includes.
- The workstation can reach `https://b1tr0n1n.github.io` (where the add-in's files are hosted) and `https://api.anthropic.com`.
- An Anthropic API key (console.anthropic.com). Usage is billed per token, separately from any Claude subscription.

## Install (classic Outlook + on-prem Exchange)

1. Check the network from the work machine. In Edge, open
   `https://b1tr0n1n.github.io/outlook-claude/taskpane.html`. A dark page with "CLAUDE" at the top means it's fine.
   Then open `https://api.anthropic.com/v1/messages`. A JSON error page means it's reachable; a proxy block page means it's not.
2. Download `manifest.xml` from this repo to the machine.
3. In Outlook: **File → Manage Add-ins**. On on-prem Exchange this opens the Exchange add-ins page in your browser. (Alternatively: **Home → Get Add-ins → My add-ins**.)
4. Click **+** (or **Custom add-ins → Add a custom add-in**) → **Add from file…** → pick `manifest.xml` → **Install**.
5. Restart Outlook. Open any email: **Claude** appears on the Home ribbon. In a new email or reply it's on the Message ribbon.
6. On first open the pane asks for your API key. Paste it, optionally fill **About you** (role, tone, sign-off), and **Save**.

### If "Add from file" is missing

Your Exchange admin has removed **My Custom Apps** from your role assignment policy. Either they add it back, or they install the add-in for you or for the org:

```powershell
# Exchange Management Shell
New-App -Mailbox you@company.com -FileData ([System.IO.File]::ReadAllBytes("C:\path\manifest.xml"))
```

## COM add-in (recommended for on-prem Exchange)

`com/` is a classic COM add-in (C#, .NET Framework 4.8, which Windows 10/11 already has). It installs on the PC for the current user, so Exchange's add-in policies never come into it, and it needs no admin rights. Same buttons and prompts as the other two versions. The request runs in the background, so Outlook doesn't freeze, and the answer opens in a window where you can edit it before using it.

1. Download `ClaudeOutlook-COM.zip` from the site, unblock it (Properties → Unblock) and extract it.
2. Close Outlook and run `install.cmd`. It copies the DLL to `%LOCALAPPDATA%\ClaudeOutlook` and registers it under HKCU, for both 32-bit and 64-bit Office.
3. In Outlook: **Claude → Settings**, paste the key, **Test Connection**, **Save**. The key is stored DPAPI-encrypted in `HKCU\Software\ClaudeOutlook`. A key already saved by the VBA macros is picked up automatically.

If the group doesn't appear: **File → Options → Add-ins → Manage: COM Add-ins → Go** and tick it. Errors go to `%LOCALAPPDATA%\ClaudeOutlook\log.txt` (never keys or mail content). `uninstall.cmd` removes everything, including the saved key. Group policy can still block it, by allowing only listed add-ins or blocking unsigned DLLs; then only IT can allow it.

Build (Linux works): `com/build.sh` builds at low priority on one core, runs 79 tests (prompts, API client, JSON, ribbon XML against Microsoft's customUI schema, the DLL's COM metadata against what install.cmd registers) and packages `com/dist/ClaudeOutlook-COM.zip`. Then `./build.sh` copies it into `docs/`.

## Thunderbird extension

`thunderbird/` is a Manifest V3 MailExtension for Thunderbird 128 or later (Linux, macOS, Windows), with the same actions and the same prompts and API client: `src/prompts.js`, `src/claude.js` and the task pane styles are copied into the package as-is. Proton Mail works through Proton Mail Bridge, because Bridge makes it an ordinary IMAP account in Thunderbird. Anything you run Claude on is decrypted and sent to Anthropic.

1. Download `claude-thunderbird.xpi` from the site (or run `thunderbird/build.sh`).
2. Thunderbird: **☰ → Add-ons and Themes →** gear → **Install Add-on From File…** If your build refuses an unsigned add-on, use **gear → Debug Add-ons → Load Temporary Add-on…** and pick the .xpi. That lasts until Thunderbird restarts.
3. Click **Claude** on the message toolbar (reading) or the compose toolbar (writing). A Claude window opens for that message. Paste the key on first run.

Reading: Summarize, Action items, Draft reply. **Open as reply** starts a real Thunderbird reply with the draft above the quote. Writing: Improve, Shorten, Professional, Friendlier, Notes → email, Do it. It works on the selection, through a compose script registered at startup, or on your part of the draft (everything above the quote, signature or forwarded message). **Replace my text** leaves the quote and signature alone. The result is editable before you use it. Permissions: read messages, compose, storage, `sensitiveDataUpload` (Thunderbird's disclosure that mail goes to a remote server), and host access to `api.anthropic.com` only. The key sits unencrypted in the Thunderbird profile's extension storage.

Tests check every manifest key, permission and `messenger.*` call against Thunderbird's own API schemas (`thunderbird/test/tb-api.json`, condensed from [webext-annotated-schemas](https://github.com/thunderbird/webext-annotated-schemas) `esr-mv3` by `scripts/tb-api-snapshot.js`), and drive the panel in jsdom against a fake `messenger`.

## No add-in route: VBA macros

If Exchange won't let you install the add-in, `vba/ClaudeOutlook.bas` provides the same features as Outlook macros. They need no Exchange, no install and no admin rights. Outlook (classic, Windows) runs them directly and calls the API through WinHTTP, falling back to WinINet (the Edge/IE proxy settings).

1. Outlook → **Alt+F11** → **File → Import File…** → `ClaudeOutlook.bas` (also downloadable from the site's home page).
2. Run `Claude_SetKey` once (Alt+F8 in Outlook). It's stored in `HKCU\Software\VB and VBA Program Settings\ClaudeOutlook`. Optionally run `Claude_SetAboutMe` and `Claude_SetModel`.
3. **File → Options → Customize Ribbon → Choose commands from: Macros.** Add the reading macros (`Claude_Summarize`, `Claude_ActionItems`, `Claude_DraftReply`, `Claude_DraftReplyAll`, `Claude_Ask`) to the Home tab, and the writing macros (`Claude_Improve`, `Claude_Shorten`, `Claude_Professional`, `Claude_Friendlier`, `Claude_NotesToEmail`, `Claude_DoIt`) to the New Mail Message tab.
4. If they won't run, check **Trust Center → Macro Settings**. If it's "signed macros only", self-sign with `SELFCERT.EXE` and then **Tools → Digital Signature** in the VBA editor. If group policy disables macros outright, only the add-in route is left.

Differences from the add-in: the call is synchronous, so Outlook freezes until Claude answers (the default model is Sonnet 5.5 for that reason). Summaries and answers open in Notepad. Draft reply opens a real reply with the draft inserted. Writing actions replace the selection, or ask whether to replace the whole draft or insert at the cursor. They also work on inline replies in the reading pane.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Pane is blank or "Add-in error" | The workstation can't load `b1tr0n1n.github.io`, because a proxy or web filter blocks it |
| "Could not reach api.anthropic.com" | Proxy or firewall blocks the API, or TLS inspection breaks it |
| "The API key was rejected" | Wrong or revoked key. Re-enter it in Settings |
| "Rate limited or out of credit" | Add credit or raise limits in console.anthropic.com |
| No Claude button | Outlook not restarted, the add-in is disabled under File → Manage Add-ins, or the server is Exchange 2013 |

## Develop

```bash
npm install
npm test            # 76 tests: ES5/IE11 guard, prompts, API client, task pane in jsdom, build URLs, VBA structure, Thunderbird extension
./build.sh          # renders docs/ + manifest.xml; BASE_URL=https://other/host ./build.sh to host elsewhere
```

`docs/` is the deployed site (GitHub Pages serves `main:/docs`). Bump `<Version>` in `manifest.template.xml` when the manifest changes; code-only changes go live on the next page load.
