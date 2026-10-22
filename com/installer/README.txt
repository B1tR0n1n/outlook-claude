Claude for Outlook - COM add-in
================================

For classic Outlook on Windows 10/11 (Outlook 2016, 2019, 2021 or Microsoft 365).
Works with on-prem Exchange: it installs on your PC, not on the mail server.
No admin rights needed.

Install
  1. Close Outlook.
  2. Double-click install.cmd. If Windows says "Windows protected your PC",
     click More info, then Run anyway.
  3. Start Outlook. The Claude group is at the right end of the Home tab.
  4. Click Claude > Settings, paste your Claude API key (starts sk-ant-api03-,
     from platform.claude.com > Settings > API keys), click Test Connection,
     then Save.

Use
  Main window: select an email, then Summarize, Draft Reply, Action Items, Ask.
  Writing an inline reply: Rewrite Reply menu.
  Open email: same buttons on the Message tab.
  New email or reply window: Improve, Shorten, Professional, Friendlier,
  Notes to Email, Do It. Select text first to work on just that part.

If the Claude group doesn't appear
  File > Options > Add-ins > Manage: COM Add-ins > Go. Tick "Claude for Outlook".
  If it says a runtime error occurred, send the log:
  %LOCALAPPDATA%\ClaudeOutlook\log.txt

Uninstall
  Close Outlook, double-click uninstall.cmd. It also deletes the saved key.
