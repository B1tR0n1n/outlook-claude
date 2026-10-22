using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace ClaudeOutlook.Core
{
    public enum CommandKind { Read, Compose, Settings }

    // One ribbon button. Id is the ribbon control id and what OnAction receives.
    public sealed class Command
    {
        public Command(string id, string label, CommandKind kind, string action, string tip, bool toAll = false)
        {
            Id = id; Label = label; Kind = kind; Action = action; Tip = tip; ToAll = toAll;
        }
        public string Id { get; }
        public string Label { get; }
        public CommandKind Kind { get; }
        public string Action { get; }
        public string Tip { get; }
        public bool ToAll { get; }
    }

    public static class Ribbon
    {
        public const string Namespace = "http://schemas.microsoft.com/office/2009/07/customui";
        public const string ExplorerId = "Microsoft.Outlook.Explorer";
        public const string ReadId = "Microsoft.Outlook.Mail.Read";
        public const string ComposeId = "Microsoft.Outlook.Mail.Compose";
        public const string ImageId = "claude";

        public static readonly Command Summarize = new Command("claudeSummarize", "Summarize", CommandKind.Read, "summarize", "Summarize this email and its thread.");
        public static readonly Command Reply = new Command("claudeReply", "Draft Reply", CommandKind.Read, "reply", "Open a reply with Claude's draft in it.");
        public static readonly Command ReplyAll = new Command("claudeReplyAll", "Draft Reply All", CommandKind.Read, "reply", "Open a reply-all with Claude's draft in it.", toAll: true);
        public static readonly Command ActionItems = new Command("claudeActions", "Action Items", CommandKind.Read, "actions", "List requests, deadlines and open questions.");
        public static readonly Command Ask = new Command("claudeAsk", "Ask", CommandKind.Read, "ask", "Ask Claude anything about this email.");
        public static readonly Command Improve = new Command("claudeImprove", "Improve", CommandKind.Compose, "improve", "Clearer, tighter, correct grammar. Works on the selection, or the whole draft.");
        public static readonly Command Shorten = new Command("claudeShorten", "Shorten", CommandKind.Compose, "shorten", "About half the length, every fact kept.");
        public static readonly Command Professional = new Command("claudeProfessional", "Professional", CommandKind.Compose, "professional", "Professional, direct tone for a client.");
        public static readonly Command Friendly = new Command("claudeFriendly", "Friendlier", CommandKind.Compose, "friendly", "Warmer tone, same substance.");
        public static readonly Command Draft = new Command("claudeDraft", "Notes to Email", CommandKind.Compose, "draft", "Turn rough notes into a ready-to-send email.");
        public static readonly Command DoIt = new Command("claudeDoIt", "Do It...", CommandKind.Compose, "ask", "Tell Claude what to do with the selection or draft.");
        public static readonly Command Settings = new Command("claudeSettings", "Settings", CommandKind.Settings, null, "API key, model, and what Claude should know about you.");

        public static readonly IReadOnlyList<Command> All = new[]
        {
            Summarize, Reply, ReplyAll, ActionItems, Ask, Improve, Shorten, Professional, Friendly, Draft, DoIt, Settings,
        };

        private static readonly Command[] Rewrites = { Improve, Shorten, Professional, Friendly, Draft, DoIt };

        public static Command Find(string id) => All.FirstOrDefault(c => c.Id == id);

        // Ribbon XML for one Outlook window type, or null for windows Claude doesn't touch.
        public static string For(string ribbonId)
        {
            switch (ribbonId)
            {
                case ExplorerId:
                    // Main window: read the selected email, and rewrite an inline reply in the reading pane.
                    return Document("TabMail",
                        Large(Summarize) + Large(Reply) + Normal(ActionItems) + Normal(ReplyAll) + Normal(Ask) +
                        Menu("claudeRewriteMenu", "Rewrite Reply", "Rewrite the inline reply you're writing.", Rewrites) +
                        Normal(Settings));
                case ReadId:
                    return Document("TabReadMessage",
                        Large(Summarize) + Large(Reply) + Normal(ActionItems) + Normal(ReplyAll) + Normal(Ask) + Normal(Settings));
                case ComposeId:
                    return Document("TabNewMailMessage",
                        Large(Improve) + Normal(Shorten) + Normal(Professional) + Normal(Friendly) +
                        Large(Draft) + Large(DoIt) + Normal(Settings));
                default:
                    return null;
            }
        }

        private static string Document(string tabIdMso, string controls) =>
            "<customUI xmlns=\"" + Namespace + "\" loadImage=\"LoadImage\">" +
            "<ribbon><tabs><tab idMso=\"" + tabIdMso + "\">" +
            "<group id=\"claudeGroup\" label=\"Claude\">" + controls + "</group>" +
            "</tab></tabs></ribbon></customUI>";

        private static string Large(Command c) => Button(c, " size=\"large\"");
        private static string Normal(Command c) => Button(c, "");

        private static string Button(Command c, string size) =>
            "<button id=\"" + c.Id + "\" label=\"" + Attr(c.Label) + "\"" + size + " image=\"" + ImageId + "\"" +
            " screentip=\"" + Attr(c.Label) + "\" supertip=\"" + Attr(c.Tip) + "\" onAction=\"OnAction\"/>";

        private static string Menu(string id, string label, string tip, IEnumerable<Command> items)
        {
            var sb = new StringBuilder();
            sb.Append("<menu id=\"").Append(id).Append("\" label=\"").Append(Attr(label)).Append("\" size=\"large\" image=\"")
              .Append(ImageId).Append("\" screentip=\"").Append(Attr(label)).Append("\" supertip=\"").Append(Attr(tip)).Append("\">");
            foreach (var c in items) sb.Append(Button(c, ""));
            return sb.Append("</menu>").ToString();
        }

        private static string Attr(string s) => TextFormat.EscapeHtml(s);
    }
}
