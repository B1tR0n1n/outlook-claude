using System;
using System.Text;

namespace ClaudeOutlook.Core
{
    // Moving text between Claude (\n), email HTML, and Word ranges (\r paragraphs, \v line breaks).
    public static class TextFormat
    {
        public static string EscapeHtml(string s) =>
            (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");

        // Blank lines split paragraphs; single newlines become <br>.
        public static string TextToHtml(string text)
        {
            var paras = (text ?? "").Replace("\r\n", "\n").Split(new[] { "\n\n" }, StringSplitOptions.None);
            var sb = new StringBuilder();
            foreach (var p in paras)
            {
                var para = p.Trim('\n');
                if (para.Trim().Length == 0) continue;
                sb.Append("<p>").Append(EscapeHtml(para).Replace("\n", "<br>")).Append("</p>");
            }
            return sb.ToString();
        }

        // Puts fragment right after the <body ...> tag, above the signature and quoted thread.
        public static string InsertAtBodyStart(string html, string fragment)
        {
            html = html ?? "";
            var body = html.IndexOf("<body", StringComparison.OrdinalIgnoreCase);
            var close = body >= 0 ? html.IndexOf('>', body) : -1;
            return close < 0 ? fragment + html : html.Substring(0, close + 1) + fragment + html.Substring(close + 1);
        }

        public static string FromWord(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var t = s.Replace("\r\n", "\n").Replace('\r', '\n').Replace('\v', '\n').Replace("\a", "").Replace("\f", "\n");
            return t.TrimEnd('\n');
        }

        public static string ToWord(string s) => (s ?? "").Replace("\r\n", "\n").Replace('\n', '\r');
    }
}
