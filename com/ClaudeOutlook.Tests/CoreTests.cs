using System;
using System.Collections.Generic;
using System.Linq;
using ClaudeOutlook.Core;
using Xunit;

namespace ClaudeOutlook.Tests
{
    public sealed class JsonTests
    {
        [Fact]
        public void Quote_EscapesEverythingTheApiCouldChokeOn()
        {
            Assert.Equal("\"a\\\"b\\\\c\\nd\\re\\tf\\u0001\\u2028\"", Json.Quote("a\"b\\c\nd\re\tf\u0001\u2028"));
            Assert.Equal("\"\"", Json.Quote(null));
            Assert.Equal("\"caf\u00e9 \u2014 \U0001F600\"", Json.Quote("caf\u00e9 \u2014 \U0001F600"));
        }

        [Fact]
        public void Parse_RoundTripsQuotedStrings()
        {
            var s = "line1\nline2 \"quoted\" \\ tab\t \u0007 \u00e9 \U0001F600";
            Assert.Equal(s, Json.Parse(Json.Quote(s)));
        }

        [Fact]
        public void Parse_ReadsNestedValues()
        {
            var v = Json.Parse(" {\"a\":[1,2.5,-3e2,true,false,null,{}],\"b\":{\"c\":\"\\u00e9\\/\"},\"d\":[]} ");
            var a = (List<object>)Json.Get(v, "a");
            Assert.Equal(new object[] { 1.0, 2.5, -300.0, true, false, null }, a.Take(6).ToArray());
            Assert.Empty((Dictionary<string, object>)a[6]);
            Assert.Equal("\u00e9/", Json.Get(v, "b", "c"));
            Assert.Empty((List<object>)Json.Get(v, "d"));
            Assert.Null(Json.Get(v, "missing", "x"));
            Assert.Null(Json.Get(v, "a", "x"));
        }

        [Theory]
        [InlineData("")]
        [InlineData("{")]
        [InlineData("{\"a\" 1}")]
        [InlineData("{\"a\":1,}")]
        [InlineData("[1 2]")]
        [InlineData("\"open")]
        [InlineData("\"bad \\q\"")]
        [InlineData("\"bad \\u12\"")]
        [InlineData("tru")]
        [InlineData("{} x")]
        [InlineData("<html>")]
        [InlineData("{1:2}")]
        [InlineData("[1,")]
        public void Parse_RejectsMalformedJson(string text)
        {
            Assert.Throws<FormatException>(() => Json.Parse(text));
        }
    }

    public sealed class PromptsTests
    {
        private static EmailInfo Mail(string body = "Can you send the Q3 numbers by Friday?") => new EmailInfo
        {
            Subject = "Q3", From = "Dana <dana@example.com>", To = "Keith", Cc = "", Date = "2026-10-22 09:00", Body = body,
        };

        [Fact]
        public void System_AppendsTheUsersContextOnlyWhenGiven()
        {
            Assert.Equal(Prompts.BaseSystem, Prompts.System("  "));
            Assert.Equal(Prompts.BaseSystem, Prompts.System(null));
            Assert.EndsWith("\n\nAbout the user: MSP engineer", Prompts.System(" MSP engineer "));
        }

        [Fact]
        public void BuildRead_WrapsTheEmailAndAddsTheTask()
        {
            var p = Prompts.BuildRead("summarize", Mail(), null);
            Assert.StartsWith("<email>\nSubject: Q3\nFrom: Dana <dana@example.com>\nTo: Keith\nDate: 2026-10-22 09:00\n\n", p);
            Assert.DoesNotContain("Cc:", p);
            Assert.Contains("</email>\n\n" + Prompts.ReadTasks["summarize"], p);
        }

        [Fact]
        public void BuildRead_ReplyCarriesTheUsersInstructions()
        {
            Assert.EndsWith(Prompts.ReadTasks["reply"] + "\n\nThe user's instructions: say yes", Prompts.BuildRead("reply", Mail(), " say yes "));
            Assert.EndsWith(Prompts.ReadTasks["reply"], Prompts.BuildRead("reply", Mail(), ""));
        }

        [Fact]
        public void BuildRead_AskNeedsAQuestion()
        {
            Assert.EndsWith("</email>\n\nWho owns this?", Prompts.BuildRead("ask", Mail(), " Who owns this? "));
            Assert.Throws<ArgumentException>(() => Prompts.BuildRead("ask", Mail(), " "));
            Assert.Throws<ArgumentException>(() => Prompts.BuildRead("nope", Mail(), null));
        }

        [Fact]
        public void Clip_TruncatesLongBodiesAndSaysSo()
        {
            var p = Prompts.BuildRead("actions", Mail(new string('x', Prompts.MaxBodyChars + 50)), null);
            Assert.Contains(new string('x', Prompts.MaxBodyChars) + "\n\n[... truncated", p);
            Assert.DoesNotContain(new string('x', Prompts.MaxBodyChars + 1), p);
            Assert.Equal("short", Prompts.Clip("short"));
            Assert.Equal("", Prompts.Clip(null));
        }

        [Fact]
        public void BuildCompose_WrapsTextWithSubjectAndTask()
        {
            var p = Prompts.BuildCompose("shorten", "hi there", null, "Re: Q3");
            Assert.Equal("Subject of this email: Re: Q3\n\n<text>\nhi there\n</text>\n\n" + Prompts.ComposeTasks["shorten"], p);
            Assert.StartsWith("<text>", Prompts.BuildCompose("improve", "x", null, ""));
            Assert.EndsWith("translate to Spanish", Prompts.BuildCompose("ask", "x", " translate to Spanish ", null));
        }

        [Fact]
        public void BuildCompose_RefusesEmptyTextOrInstruction()
        {
            Assert.Throws<ArgumentException>(() => Prompts.BuildCompose("improve", " \n ", null, null));
            Assert.Throws<ArgumentException>(() => Prompts.BuildCompose("ask", "x", "", null));
            Assert.Throws<ArgumentException>(() => Prompts.BuildCompose("nope", "x", null, null));
        }

        [Theory]
        [InlineData("Dana", "dana@example.com", "Dana <dana@example.com>")]
        [InlineData("Dana", "/o=ExchangeLabs/ou=Exchange/cn=Recipients/cn=dana", "Dana")]
        [InlineData("dana@example.com", "DANA@example.com", "dana@example.com")]
        [InlineData("", "dana@example.com", "dana@example.com")]
        [InlineData(null, null, "")]
        public void Person_FormatsSenders(string name, string address, string expected)
        {
            Assert.Equal(expected, Prompts.Person(name, address));
        }
    }

    public sealed class TextFormatTests
    {
        [Fact]
        public void TextToHtml_MakesParagraphsAndEscapes()
        {
            Assert.Equal("<p>Hi &lt;Dana&gt; &amp; &quot;team&quot;</p><p>Line 1<br>Line 2</p>",
                TextFormat.TextToHtml("Hi <Dana> & \"team\"\r\n\r\nLine 1\nLine 2\n\n\n"));
            Assert.Equal("", TextFormat.TextToHtml(null));
        }

        [Fact]
        public void InsertAtBodyStart_GoesAfterTheBodyTag()
        {
            Assert.Equal("<html><BODY lang=EN><p>x</p><div>sig</div></BODY></html>",
                TextFormat.InsertAtBodyStart("<html><BODY lang=EN><div>sig</div></BODY></html>", "<p>x</p>"));
            Assert.Equal("<p>x</p><div>no body</div>", TextFormat.InsertAtBodyStart("<div>no body</div>", "<p>x</p>"));
            Assert.Equal("<p>x</p>", TextFormat.InsertAtBodyStart(null, "<p>x</p>"));
        }

        [Fact]
        public void WordText_ConvertsBothWays()
        {
            Assert.Equal("a\nb\nc\nd", TextFormat.FromWord("a\rb\vc\r\nd\a\r\r"));
            Assert.Equal("", TextFormat.FromWord(null));
            Assert.Equal("a\rb\rc", TextFormat.ToWord("a\r\nb\nc"));
            Assert.Equal("", TextFormat.ToWord(null));
        }
    }

    public sealed class ApiKeyTests
    {
        [Theory]
        [InlineData("sk-ant-api03-abc", KeyKind.Claude)]
        [InlineData("  sk-ant-api03-abc  ", KeyKind.Claude)]
        [InlineData("sk-ant-admin01-abc", KeyKind.Admin)]
        [InlineData("sk-ant-api01-abc", KeyKind.Unusual)]
        [InlineData("sk-proj-abc", KeyKind.NotAnthropic)]
        [InlineData("", KeyKind.Empty)]
        [InlineData(null, KeyKind.Empty)]
        public void Classify_SortsKeyKinds(string key, KeyKind kind)
        {
            Assert.Equal(kind, ApiKeys.Classify(key));
        }
    }
}
