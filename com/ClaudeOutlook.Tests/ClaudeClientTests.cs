using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using ClaudeOutlook.Core;
using Xunit;

namespace ClaudeOutlook.Tests
{
    public sealed class ClaudeClientTests
    {
        private sealed class FakeHandler : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _respond;
            public FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) { _respond = respond; }
            public HttpRequestMessage Request { get; private set; }
            public string Body { get; private set; }

            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                Request = request;
                Body = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
                return await _respond(request, ct);
            }
        }

        private static FakeHandler Replying(HttpStatusCode status, string body) =>
            new FakeHandler((r, ct) => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") }));

        private const string OkBody = "{\"content\":[{\"type\":\"text\",\"text\":\"Hello\"},{\"type\":\"tool_use\"},{\"type\":\"text\",\"text\":\" there \"}],\"stop_reason\":\"end_turn\"}";

        [Fact]
        public async Task SendAsync_PostsTheMessagesApiContract()
        {
            var h = Replying(HttpStatusCode.OK, OkBody);
            using var c = new ClaudeClient(h);
            var r = await c.SendAsync(" sk-ant-api03-k ", "claude-haiku-5-5", "sys \"x\"", "hi\nthere", CancellationToken.None);

            Assert.True(r.Ok);
            Assert.Equal("Hello there", r.Text);
            Assert.Equal(HttpMethod.Post, h.Request.Method);
            Assert.Equal(ClaudeClient.Endpoint, h.Request.RequestUri.ToString());
            Assert.Equal("sk-ant-api03-k", h.Request.Headers.GetValues("x-api-key").Single());
            Assert.Equal("2023-06-01", h.Request.Headers.GetValues("anthropic-version").Single());
            Assert.Equal("application/json", h.Request.Content.Headers.ContentType.MediaType);

            var body = Json.Parse(h.Body);
            Assert.Equal("claude-haiku-5-5", Json.Get(body, "model"));
            Assert.Equal(4096.0, Json.Get(body, "max_tokens"));
            Assert.Equal("sys \"x\"", Json.Get(body, "system"));
            var msg = ((System.Collections.Generic.List<object>)Json.Get(body, "messages")).Single();
            Assert.Equal("user", Json.Get(msg, "role"));
            Assert.Equal("hi\nthere", Json.Get(msg, "content"));
        }

        [Fact]
        public async Task SendAsync_UsesTheDefaultModelWhenNoneIsSet()
        {
            var h = Replying(HttpStatusCode.OK, OkBody);
            using var c = new ClaudeClient(h);
            await c.SendAsync("sk-ant-api03-k", " ", "s", "p", CancellationToken.None);
            Assert.Equal(ClaudeClient.DefaultModel, Json.Get(Json.Parse(h.Body), "model"));
        }

        [Fact]
        public async Task SendAsync_WithoutAKeyNeverCallsTheNetwork()
        {
            var h = Replying(HttpStatusCode.OK, OkBody);
            using var c = new ClaudeClient(h);
            var r = await c.SendAsync("  ", null, "s", "p", CancellationToken.None);
            Assert.Equal(ClaudeClient.NoKey, r.Error);
            Assert.Null(h.Request);
        }

        [Theory]
        [InlineData(401, "sk-ant-api03-")]
        [InlineData(403, "not allowed to do that: nope")]
        [InlineData(404, "Model not found: nope Pick another")]
        [InlineData(407, "proxy wants a login")]
        [InlineData(413, "too large")]
        [InlineData(429, "Rate limited or out of credit: nope")]
        [InlineData(529, "Anthropic API error 529")]
        [InlineData(400, "Request failed (400): nope")]
        public async Task SendAsync_TurnsHttpErrorsIntoPlainEnglish(int status, string expected)
        {
            using var c = new ClaudeClient(Replying((HttpStatusCode)status, "{\"type\":\"error\",\"error\":{\"type\":\"x\",\"message\":\"nope\"}}"));
            var r = await c.SendAsync("sk-ant-api03-k", null, "s", "p", CancellationToken.None);
            Assert.False(r.Ok);
            Assert.Contains(expected, r.Error);
        }

        [Fact]
        public void FriendlyError_CopesWithNonJsonBodies()
        {
            Assert.Equal("Anthropic API error 502. Try again in a minute.", ClaudeClient.FriendlyError(502, "<html>gateway</html>"));
            Assert.Equal("Request failed (400).", ClaudeClient.FriendlyError(400, "<html>"));
            Assert.Equal("Request failed (400).", ClaudeClient.FriendlyError(400, null));
        }

        [Fact]
        public async Task SendAsync_ReportsUnreachableNetworksWithTheCause()
        {
            var h = new FakeHandler((r, ct) => throw new HttpRequestException("outer", new WebException("The remote name could not be resolved")));
            using var c = new ClaudeClient(h);
            var r = await c.SendAsync("sk-ant-api03-k", null, "s", "p", CancellationToken.None);
            Assert.Equal(ClaudeClient.Unreachable + " (The remote name could not be resolved)", r.Error);
        }

        [Fact]
        public async Task SendAsync_DistinguishesCancelFromTimeout()
        {
            var hang = new FakeHandler(async (r, ct) => { await Task.Delay(Timeout.Infinite, ct); return null; });
            using var c = new ClaudeClient(hang);

            using var cts = new CancellationTokenSource(50);
            var cancelled = await c.SendAsync("sk-ant-api03-k", null, "s", "p", cts.Token);
            Assert.True(cancelled.Cancelled);
            Assert.False(cancelled.Ok);

            var timeout = new FakeHandler((r, ct) => throw new TaskCanceledException("timeout"));
            using var c2 = new ClaudeClient(timeout);
            var timedOut = await c2.SendAsync("sk-ant-api03-k", null, "s", "p", CancellationToken.None);
            Assert.Equal(ClaudeClient.TimedOut, timedOut.Error);
        }

        [Theory]
        [InlineData("{\"content\":[],\"stop_reason\":\"refusal\"}", "Claude returned no text (refusal).")]
        [InlineData("{\"content\":[{\"type\":\"text\",\"text\":\"  \"}]}", "Claude returned no text.")]
        [InlineData("{}", "Claude returned no text.")]
        [InlineData("not json", "Unreadable response from the API.")]
        public void Parse_FailsOnEmptyOrBrokenResponses(string body, string error)
        {
            Assert.Equal(error, ClaudeClient.Parse(200, body).Error);
        }

        [Fact]
        public void Parse_FlagsTruncatedAnswers()
        {
            var r = ClaudeClient.Parse(200, "{\"content\":[{\"type\":\"text\",\"text\":\"long\"}],\"stop_reason\":\"max_tokens\"}");
            Assert.Equal("long\n\n[cut off: reached the length limit]", r.Text);
        }

        [Fact]
        public void Models_DefaultIsTheFirstAndIdsAreUnique()
        {
            Assert.Equal("claude-opus-5-5", ClaudeClient.DefaultModel);
            Assert.Equal(ClaudeClient.Models.Count, ClaudeClient.Models.Select(m => m.Id).Distinct().Count());
            Assert.Equal("Opus 5.5 (best)", ClaudeClient.Models[0].ToString());
        }
    }
}
