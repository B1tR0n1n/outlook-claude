using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using ClaudeOutlook.Core;
using Outlook = Microsoft.Office.Interop.Outlook;

namespace ClaudeOutlook.AddIn
{
    // What each ribbon button does. Runs on Outlook's UI thread; only the HTTP call goes to the background.
    internal sealed class Commands : IDisposable
    {
        private readonly ClaudeClient _client;

        public Commands(Outlook.Application app)
        {
            if (app == null) throw new ArgumentNullException(nameof(app));
            // System proxy (same as Edge), signed in as the Windows user for authenticating proxies.
            var handler = new HttpClientHandler { UseProxy = true, DefaultProxyCredentials = CredentialCache.DefaultCredentials };
            _client = new ClaudeClient(handler);
        }

        public void Run(string controlId, object context)
        {
            var cmd = Ribbon.Find(controlId) ?? throw new InvalidOperationException("Unknown button: " + controlId);
            var owner = Ui.OwnerOf(context);
            switch (cmd.Kind)
            {
                case CommandKind.Settings: SettingsForm.Open(owner, _client); break;
                case CommandKind.Read: RunRead(cmd, context, owner); break;
                case CommandKind.Compose: RunCompose(cmd, context, owner); break;
            }
        }

        private void RunRead(Command cmd, object context, IWin32Window owner)
        {
            var mail = MailContext.SelectedMail(context, out var problem);
            if (mail == null) { Ui.Warn(owner, problem); return; }

            string extra = null;
            if (cmd.Action == "reply")
                extra = PromptForm.Ask(owner, "Claude: " + cmd.Label, "What should the reply say? (optional)", optional: true);
            else if (cmd.Action == "ask")
                extra = PromptForm.Ask(owner, "Claude: Ask", "Your question about this email", optional: false);
            if ((cmd.Action == "reply" || cmd.Action == "ask") && extra == null) return;

            var prompt = Prompts.BuildRead(cmd.Action, MailContext.Describe(mail), extra);
            Send(owner, "Claude: " + cmd.Label, prompt, (window, text) =>
            {
                if (cmd.Action == "reply")
                {
                    MailContext.OpenReply(mail, text, cmd.ToAll);
                    window.Close();
                }
                else
                {
                    window.ShowResult(text);
                }
            });
        }

        private void RunCompose(Command cmd, object context, IWin32Window owner)
        {
            var draft = MailContext.CurrentDraft(context, out var problem);
            if (draft == null) { Ui.Warn(owner, problem); return; }
            if (draft.SourceText.Trim().Length == 0)
            {
                Ui.Warn(owner, "There is no text to work on. Write something or select it first.");
                return;
            }

            string extra = null;
            if (cmd.Action == "ask")
            {
                extra = PromptForm.Ask(owner, "Claude: Do It",
                    "What should Claude do with " + (draft.HasSelection ? "the selected text?" : "this draft?"), optional: false);
                if (extra == null) return;
            }

            var prompt = Prompts.BuildCompose(cmd.Action, draft.SourceText, extra, draft.Subject);
            Send(owner, "Claude: " + cmd.Label, prompt, (window, text) => window.ShowResult(text, draft.HasSelection
                ? new[]
                {
                    new ResultAction("Replace Selection", draft.ReplaceSelection, primary: true),
                    new ResultAction("Insert After", draft.InsertAfterSelection),
                }
                : new[]
                {
                    new ResultAction("Replace Draft Text", draft.ReplaceDraftText,
                        tip: "Replaces what you wrote. Outlook's signature and the quoted thread stay.", primary: true),
                    new ResultAction("Insert at Cursor", draft.InsertAtCursor),
                }));
        }

        private void Send(IWin32Window owner, string title, string prompt, Action<ResultForm, string> onText)
        {
            var settings = Settings.Load();
            if (ApiKeys.Classify(settings.ApiKey) == KeyKind.Empty)
            {
                if (!SettingsForm.Open(owner, _client)) return;
                settings = Settings.Load();
            }

            var model = ClaudeClient.Models.FirstOrDefault(m => m.Id == settings.Model)?.Label ?? settings.Model;
            var window = new ResultForm(title, model);
            window.Show(owner);

            _client.SendAsync(settings.ApiKey, settings.Model, Prompts.System(settings.Context), prompt, window.Token)
                .ContinueWith(t =>
                {
                    var result = t.Status == TaskStatus.RanToCompletion
                        ? t.Result
                        : ClaudeResult.Fail("Request failed: " + t.Exception?.GetBaseException().Message);
                    if (result.Cancelled) return;
                    window.Deliver(() =>
                    {
                        if (!result.Ok) { window.ShowError(result.Error); return; }
                        try { onText(window, result.Text); }
                        catch (Exception ex)
                        {
                            Log.Error("Deliver " + title, ex);
                            window.ShowResult(result.Text);
                        }
                    });
                }, TaskScheduler.Default);
        }

        public void Dispose() => _client.Dispose();
    }
}
