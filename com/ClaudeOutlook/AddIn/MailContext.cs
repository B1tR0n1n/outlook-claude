using System;
using System.Runtime.InteropServices;
using ClaudeOutlook.Core;
using Outlook = Microsoft.Office.Interop.Outlook;
using Word = Microsoft.Office.Interop.Word;

namespace ClaudeOutlook.AddIn
{
    // Finds the email or draft behind the ribbon button that was clicked. The ribbon's Context is the
    // Explorer (main window) or Inspector (opened item) the button lives in.
    internal static class MailContext
    {
        public static Outlook.MailItem SelectedMail(object context, out string problem)
        {
            object item = null;
            try
            {
                if (context is Outlook.Inspector insp) item = insp.CurrentItem;
                else if (context is Outlook.Explorer exp && exp.Selection.Count > 0) item = exp.Selection[1];
            }
            catch (COMException ex) { Log.Error("SelectedMail", ex); }

            problem = null;
            if (item == null) problem = "Select or open an email first.";
            else if (!(item is Outlook.MailItem)) problem = "That item isn't an email.";
            return problem == null ? (Outlook.MailItem)item : null;
        }

        public static EmailInfo Describe(Outlook.MailItem mail)
        {
            var received = mail.ReceivedTime;
            return new EmailInfo
            {
                Subject = mail.Subject,
                From = Sender(mail),
                To = mail.To,
                Cc = mail.CC,
                Date = received.Year < 4000 ? received.ToString("yyyy-MM-dd HH:mm") : null,
                Body = mail.Body,
            };
        }

        private static string Sender(Outlook.MailItem mail)
        {
            string name = "", address = "";
            try
            {
                name = mail.SenderName;
                address = mail.SenderEmailAddress;
                if (mail.SenderEmailType == "EX")
                {
                    var user = mail.Sender?.GetExchangeUser();
                    if (user != null) address = user.PrimarySmtpAddress;
                }
            }
            catch (COMException) { }
            return Prompts.Person(name, address);
        }

        // Opens a reply with Claude's text at the top, above the signature Outlook adds on display.
        public static void OpenReply(Outlook.MailItem mail, string text, bool toAll)
        {
            var reply = toAll ? mail.ReplyAll() : mail.Reply();
            reply.Display(false);
            Word.Document doc = null;
            try { doc = reply.GetInspector.WordEditor as Word.Document; }
            catch (COMException) { doc = null; }

            if (doc != null)
            {
                doc.Range(0, 0).Text = TextFormat.ToWord(text) + "\r";
            }
            else if (reply.BodyFormat == Outlook.OlBodyFormat.olFormatPlain)
            {
                reply.Body = text + "\r\n\r\n" + reply.Body;
            }
            else
            {
                reply.HTMLBody = TextFormat.InsertAtBodyStart(reply.HTMLBody, TextFormat.TextToHtml(text));
            }
        }

        public static Draft CurrentDraft(object context, out string problem)
        {
            object item = null;
            Word.Document doc = null;
            try
            {
                if (context is Outlook.Inspector insp)
                {
                    item = insp.CurrentItem;
                    if (insp.EditorType == Outlook.OlEditorType.olEditorWord) doc = insp.WordEditor as Word.Document;
                }
                else if (context is Outlook.Explorer exp)
                {
                    item = exp.ActiveInlineResponse;
                    if (item != null) doc = exp.ActiveInlineResponseWordEditor as Word.Document;
                }
            }
            catch (COMException ex) { Log.Error("CurrentDraft", ex); }

            problem = null;
            if (item == null || doc == null) problem = "Open a draft first: a new email, or a reply you're writing.";
            else if (!(item is Outlook.MailItem mail)) problem = "That item isn't an email.";
            else if (mail.Sent) problem = "That email was already sent. Open a draft or a reply.";
            else
            {
                var draft = Draft.From(mail, doc);
                if (draft == null) problem = "Couldn't reach the draft's text. Click into the message body and try again.";
                return draft;
            }
            return null;
        }
    }

    // A draft being written, with the selection (or cursor) as it was when the button was clicked.
    // Word ranges track edits, so these stay right if the user keeps typing while Claude works.
    internal sealed class Draft
    {
        private readonly Word.Document _doc;
        private readonly Word.Range _target;
        private readonly Word.Range _userPart;

        private Draft(Outlook.MailItem mail, Word.Document doc, Word.Range target, Word.Range userPart)
        {
            Subject = mail.Subject;
            _doc = doc;
            _target = target;
            _userPart = userPart;
            HasSelection = target.End > target.Start;
            SourceText = TextFormat.FromWord(HasSelection ? target.Text : userPart.Text);
        }

        public string Subject { get; }
        public bool HasSelection { get; }
        public string SourceText { get; }

        public static Draft From(Outlook.MailItem mail, Word.Document doc)
        {
            Word.Range sel = null;
            try { sel = doc.Windows[1].Selection.Range; }
            catch (COMException) { sel = null; }
            if (sel == null)
            {
                try { sel = doc.Application.Selection.Range; }
                catch (COMException) { return null; }
            }
            return sel == null ? null : new Draft(mail, doc, sel.Duplicate, UserPart(doc));
        }

        // The text the user wrote: everything above Outlook's signature and quoted-original bookmarks.
        private static Word.Range UserPart(Word.Document doc)
        {
            var end = doc.Content.End;
            try
            {
                var marks = doc.Bookmarks;
                var wasShown = marks.ShowHidden;
                marks.ShowHidden = true;
                foreach (var name in new[] { "_MailAutoSig", "_MailOriginal" })
                {
                    if (marks.Exists(name)) end = Math.Min(end, marks[name].Range.Start);
                }
                marks.ShowHidden = wasShown;
            }
            catch (COMException ex) { Log.Error("UserPart", ex); }
            return doc.Range(0, end);
        }

        public bool HasTail => _userPart.End < _doc.Content.End;

        public void ReplaceSelection(string text) => _target.Text = TextFormat.ToWord(text);

        public void InsertAfterSelection(string text)
        {
            var r = _target.Duplicate;
            r.Collapse(Word.WdCollapseDirection.wdCollapseEnd);
            r.Text = "\r" + TextFormat.ToWord(text);
        }

        public void InsertAtCursor(string text)
        {
            var r = _target.Duplicate;
            r.Collapse(Word.WdCollapseDirection.wdCollapseStart);
            r.Text = TextFormat.ToWord(text);
        }

        // Replaces only the user's part, so the signature and the quoted thread stay.
        public void ReplaceDraftText(string text) =>
            _userPart.Text = TextFormat.ToWord(text) + (HasTail ? "\r\r" : "");
    }
}
