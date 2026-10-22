using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Schema;
using ClaudeOutlook.Core;
using Xunit;

namespace ClaudeOutlook.Tests
{
    // Outlook drops a ribbon silently when its XML is invalid, so validate it against Microsoft's schema here.
    public sealed class RibbonTests
    {
        private static readonly XNamespace Ns = Ribbon.Namespace;

        public static TheoryData<string> RibbonIds => new TheoryData<string> { Ribbon.ExplorerId, Ribbon.ReadId, Ribbon.ComposeId };

        private static XmlSchemaSet Schema()
        {
            var set = new XmlSchemaSet();
            set.Add(Ribbon.Namespace, Path.Combine(Paths.ComRoot, "test", "schema", "customui14.xsd"));
            set.Compile();
            return set;
        }

        [Theory]
        [MemberData(nameof(RibbonIds))]
        public void Xml_IsValidCustomUi14(string ribbonId)
        {
            var doc = XDocument.Parse(Ribbon.For(ribbonId));
            var errors = new System.Collections.Generic.List<string>();
            doc.Validate(Schema(), (s, e) => errors.Add(e.Message));
            Assert.Empty(errors);
        }

        [Theory]
        [MemberData(nameof(RibbonIds))]
        public void EveryButton_IsAKnownCommandWiredToOnAction(string ribbonId)
        {
            var doc = XDocument.Parse(Ribbon.For(ribbonId));
            Assert.Equal("LoadImage", (string)doc.Root.Attribute("loadImage"));
            var buttons = doc.Descendants(Ns + "button").ToList();
            Assert.NotEmpty(buttons);
            foreach (var b in buttons)
            {
                Assert.Equal("OnAction", (string)b.Attribute("onAction"));
                Assert.NotNull(Ribbon.Find((string)b.Attribute("id")));
                Assert.Equal(Ribbon.ImageId, (string)b.Attribute("image"));
            }
            var ids = doc.Descendants().Select(e => (string)e.Attribute("id")).Where(i => i != null).ToList();
            Assert.Equal(ids.Count, ids.Distinct().Count());
        }

        [Fact]
        public void Windows_GetTheRightButtons()
        {
            string[] Ids(string ribbonId) => XDocument.Parse(Ribbon.For(ribbonId)).Descendants(Ns + "button").Select(b => (string)b.Attribute("id")).ToArray();
            var read = Ribbon.All.Where(c => c.Kind == CommandKind.Read).Select(c => c.Id).ToArray();
            var compose = Ribbon.All.Where(c => c.Kind == CommandKind.Compose).Select(c => c.Id).ToArray();

            Assert.Equal(read.Concat(compose).Concat(new[] { "claudeSettings" }).OrderBy(x => x), Ids(Ribbon.ExplorerId).OrderBy(x => x));
            Assert.Equal(read.Concat(new[] { "claudeSettings" }).OrderBy(x => x), Ids(Ribbon.ReadId).OrderBy(x => x));
            Assert.Equal(compose.Concat(new[] { "claudeSettings" }).OrderBy(x => x), Ids(Ribbon.ComposeId).OrderBy(x => x));
        }

        [Fact]
        public void TabsAreOutlooksBuiltInOnes()
        {
            string Tab(string id) => (string)XDocument.Parse(Ribbon.For(id)).Descendants(Ns + "tab").Single().Attribute("idMso");
            Assert.Equal("TabMail", Tab(Ribbon.ExplorerId));
            Assert.Equal("TabReadMessage", Tab(Ribbon.ReadId));
            Assert.Equal("TabNewMailMessage", Tab(Ribbon.ComposeId));
        }

        [Theory]
        [InlineData("Microsoft.Outlook.Appointment")]
        [InlineData("Microsoft.Outlook.Contact")]
        [InlineData("")]
        [InlineData(null)]
        public void OtherWindows_GetNoRibbon(string ribbonId)
        {
            Assert.Null(Ribbon.For(ribbonId));
        }

        [Fact]
        public void Commands_MapToPromptActions()
        {
            foreach (var c in Ribbon.All)
            {
                if (c.Kind == CommandKind.Read) Assert.True(c.Action == "ask" || Prompts.ReadTasks.ContainsKey(c.Action), c.Id);
                if (c.Kind == CommandKind.Compose) Assert.True(c.Action == "ask" || Prompts.ComposeTasks.ContainsKey(c.Action), c.Id);
            }
            Assert.True(Ribbon.ReplyAll.ToAll);
            Assert.False(Ribbon.Reply.ToAll);
            Assert.Null(Ribbon.Find("nope"));
        }
    }
}
