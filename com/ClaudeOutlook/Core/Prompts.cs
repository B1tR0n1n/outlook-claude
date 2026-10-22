using System;
using System.Collections.Generic;

namespace ClaudeOutlook.Core
{
    // The email as the add-in read it from Outlook. Plain strings so this file needs no Office types.
    public sealed class EmailInfo
    {
        public string Subject { get; set; }
        public string From { get; set; }
        public string To { get; set; }
        public string Cc { get; set; }
        public string Date { get; set; }
        public string Body { get; set; }
    }

    // Same prompts as src/prompts.js (the Office.js add-in) and vba/ClaudeOutlook.bas.
    public static class Prompts
    {
        public const int MaxBodyChars = 60000;

        public const string BaseSystem =
            "You help the user read and write email inside Microsoft Outlook. " +
            "Reply in plain text only: no Markdown, no asterisks, no headings, no code fences. " +
            "Use short paragraphs and simple hyphen bullets when a list helps. " +
            "When you write an email, write only the body. No subject line, and no notes " +
            "before or after it. End with the user's sign-off only if their context gives one. " +
            "Never invent facts, dates, prices or commitments the source does not contain. " +
            "Where the user must supply something, write [like this].";

        public static readonly IReadOnlyDictionary<string, string> ReadTasks = new Dictionary<string, string>
        {
            ["summarize"] = "Summarize this email (and any quoted thread) in 3 to 6 short bullets. " +
                            "Lead with what is being asked of the user, if anything.",
            ["actions"] = "List every action item, request, deadline and open question in this email. " +
                          "For each, say who owns it and any date. If there are none, say so in one line.",
            ["reply"] = "Draft a reply to this email from the user.",
        };

        public static readonly IReadOnlyDictionary<string, string> ComposeTasks = new Dictionary<string, string>
        {
            ["improve"] = "Improve this email text: clearer, tighter, correct grammar. Keep the meaning, " +
                          "the facts and the user's voice. Return only the revised text.",
            ["shorten"] = "Rewrite this email text at about half the length. Keep every fact and request. " +
                          "Return only the revised text.",
            ["professional"] = "Rewrite this email text in a professional, direct tone suitable for a client. " +
                               "Return only the revised text.",
            ["friendly"] = "Rewrite this email text in a warmer, friendlier tone without losing substance. " +
                           "Return only the revised text.",
            ["draft"] = "Turn these notes into a complete, ready-to-send email body. Return only the email.",
        };

        public static string System(string userContext)
        {
            var ctx = (userContext ?? "").Trim();
            return ctx.Length == 0 ? BaseSystem : BaseSystem + "\n\nAbout the user: " + ctx;
        }

        public static string Clip(string text)
        {
            text = text ?? "";
            return text.Length <= MaxBodyChars
                ? text
                : text.Substring(0, MaxBodyChars) + "\n\n[... truncated: the email continues past this point]";
        }

        // "Name <addr>", or whichever half is usable. Raw Exchange X500 addresses ("/o=...") mean nothing to Claude.
        public static string Person(string name, string address)
        {
            name = (name ?? "").Trim();
            address = (address ?? "").Trim();
            if (address.StartsWith("/", StringComparison.Ordinal)) address = "";
            if (address.Length == 0 || string.Equals(address, name, StringComparison.OrdinalIgnoreCase)) return name;
            return name.Length == 0 ? address : name + " <" + address + ">";
        }

        public static string EmailBlock(EmailInfo m)
        {
            var lines = new List<string> { "<email>" };
            if (!string.IsNullOrWhiteSpace(m.Subject)) lines.Add("Subject: " + m.Subject);
            if (!string.IsNullOrWhiteSpace(m.From)) lines.Add("From: " + m.From);
            if (!string.IsNullOrWhiteSpace(m.To)) lines.Add("To: " + m.To);
            if (!string.IsNullOrWhiteSpace(m.Cc)) lines.Add("Cc: " + m.Cc);
            if (!string.IsNullOrWhiteSpace(m.Date)) lines.Add("Date: " + m.Date);
            lines.Add("");
            lines.Add(Clip(m.Body));
            lines.Add("</email>");
            return string.Join("\n", lines);
        }

        private static string WithInstructions(string task, string extra)
        {
            var e = (extra ?? "").Trim();
            return e.Length == 0 ? task : task + "\n\nThe user's instructions: " + e;
        }

        // action: summarize | actions | reply | ask
        public static string BuildRead(string action, EmailInfo email, string extra)
        {
            if (action == "ask")
            {
                if (string.IsNullOrWhiteSpace(extra)) throw new ArgumentException("Type a question first.");
                return EmailBlock(email) + "\n\n" + extra.Trim();
            }
            if (!ReadTasks.TryGetValue(action ?? "", out var task)) throw new ArgumentException("Unknown action: " + action);
            return EmailBlock(email) + "\n\n" + WithInstructions(task, extra);
        }

        // action: improve | shorten | professional | friendly | draft | ask
        public static string BuildCompose(string action, string text, string extra, string subject)
        {
            if (string.IsNullOrWhiteSpace(text))
                throw new ArgumentException("There is no text to work on. Write something or select it first.");
            string task;
            if (action == "ask")
            {
                if (string.IsNullOrWhiteSpace(extra)) throw new ArgumentException("Type an instruction first.");
                task = extra.Trim();
            }
            else if (ComposeTasks.TryGetValue(action ?? "", out var t)) task = WithInstructions(t, extra);
            else throw new ArgumentException("Unknown action: " + action);

            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(subject)) parts.Add("Subject of this email: " + subject);
            parts.Add("<text>\n" + Clip(text) + "\n</text>");
            parts.Add(task);
            return string.Join("\n\n", parts);
        }
    }
}
