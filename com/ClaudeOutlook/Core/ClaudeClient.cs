using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ClaudeOutlook.Core
{
    public sealed class ModelChoice
    {
        public ModelChoice(string id, string label) { Id = id; Label = label; }
        public string Id { get; }
        public string Label { get; }
        public override string ToString() => Label;
    }

    public sealed class ClaudeResult
    {
        private ClaudeResult(string text, string error, bool cancelled) { Text = text; Error = error; Cancelled = cancelled; }
        public string Text { get; }
        public string Error { get; }
        public bool Cancelled { get; }
        public bool Ok => Error == null && !Cancelled;

        public static ClaudeResult Success(string text) => new ClaudeResult(text, null, false);
        public static ClaudeResult Fail(string error) => new ClaudeResult(null, error, false);
        public static readonly ClaudeResult WasCancelled = new ClaudeResult(null, null, true);
    }

    // Claude Messages API over HttpClient. One request at a time per call; safe to share.
    public sealed class ClaudeClient : IDisposable
    {
        public const string Endpoint = "https://api.anthropic.com/v1/messages";
        public const string ApiVersion = "2023-06-01";
        public const int MaxTokens = 4096;
        public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(180);

        public static readonly IReadOnlyList<ModelChoice> Models = new[]
        {
            new ModelChoice("claude-opus-5-5", "Opus 5.5 (best)"),
            new ModelChoice("claude-sonnet-5-5", "Sonnet 5.5 (faster)"),
            new ModelChoice("claude-haiku-5-5", "Haiku 5.5 (fastest)"),
        };
        public static string DefaultModel => Models[0].Id;

        public const string NoKey = "No API key yet. Click Claude > Settings and paste your Claude API key.";
        public const string Unreachable = "Could not reach api.anthropic.com. Check the network or proxy, or whether a firewall blocks it.";
        public const string TimedOut = "Timed out waiting for Claude. Try again or pick a faster model in Settings.";

        private readonly HttpClient _http;

        public ClaudeClient(HttpMessageHandler handler)
        {
            _http = new HttpClient(handler, disposeHandler: true) { Timeout = RequestTimeout };
        }

        public static string BuildBody(string model, string system, string prompt) =>
            "{\"model\":" + Json.Quote(string.IsNullOrWhiteSpace(model) ? DefaultModel : model.Trim()) +
            ",\"max_tokens\":" + MaxTokens.ToString(CultureInfo.InvariantCulture) +
            ",\"system\":" + Json.Quote(system) +
            ",\"messages\":[{\"role\":\"user\",\"content\":" + Json.Quote(prompt) + "}]}";

        public async Task<ClaudeResult> SendAsync(string apiKey, string model, string system, string prompt, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(apiKey)) return ClaudeResult.Fail(NoKey);
            using (var req = new HttpRequestMessage(HttpMethod.Post, Endpoint))
            {
                req.Content = new StringContent(BuildBody(model, system, prompt), Encoding.UTF8, "application/json");
                req.Headers.Add("x-api-key", apiKey.Trim());
                req.Headers.Add("anthropic-version", ApiVersion);
                try
                {
                    using (var resp = await _http.SendAsync(req, ct).ConfigureAwait(false))
                    {
                        var body = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                        return Parse((int)resp.StatusCode, body);
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    return ClaudeResult.WasCancelled;
                }
                catch (OperationCanceledException)
                {
                    return ClaudeResult.Fail(TimedOut);
                }
                catch (HttpRequestException ex)
                {
                    return ClaudeResult.Fail(Unreachable + " (" + Innermost(ex).Message + ")");
                }
            }
        }

        private static Exception Innermost(Exception ex)
        {
            while (ex.InnerException != null) ex = ex.InnerException;
            return ex;
        }

        public static ClaudeResult Parse(int status, string body)
        {
            if (status != 200) return ClaudeResult.Fail(FriendlyError(status, body));
            object data;
            try { data = Json.Parse(body); }
            catch (FormatException) { return ClaudeResult.Fail("Unreadable response from the API."); }

            var sb = new StringBuilder();
            if (Json.Get(data, "content") is List<object> content)
            {
                foreach (var block in content)
                {
                    if (Json.Get(block, "type") as string == "text") sb.Append(Json.Get(block, "text") as string);
                }
            }
            var text = sb.ToString().Trim();
            var stop = Json.Get(data, "stop_reason") as string;
            if (text.Length == 0)
                return ClaudeResult.Fail("Claude returned no text" + (stop != null ? " (" + stop + ")" : "") + ".");
            if (stop == "max_tokens") text += "\n\n[cut off: reached the length limit]";
            return ClaudeResult.Success(text);
        }

        public static string FriendlyError(int status, string body)
        {
            string detail = null;
            try { detail = Json.Get(Json.Parse(body), "error", "message") as string; }
            catch (FormatException) { detail = null; }
            var tail = string.IsNullOrWhiteSpace(detail) ? "." : ": " + detail;

            switch (status)
            {
                case 401:
                    return "The API key was rejected. It has to be a Claude API key (starts sk-ant-api03-) from " +
                           "platform.claude.com > Settings > API keys. Admin and compliance keys from claude.ai can't call Claude.";
                case 403: return "This API key is not allowed to do that" + tail;
                case 404: return "Model not found" + tail + " Pick another model in Settings.";
                case 407: return "Your proxy wants a login before it lets the request out. Ask IT to allow api.anthropic.com.";
                case 413: return "The email is too large to send.";
                case 429: return "Rate limited or out of credit" + tail;
            }
            if (status >= 500) return "Anthropic API error " + status.ToString(CultureInfo.InvariantCulture) + ". Try again in a minute.";
            return "Request failed (" + status.ToString(CultureInfo.InvariantCulture) + ")" + tail;
        }

        public void Dispose() => _http.Dispose();
    }

    public enum KeyKind { Empty, Claude, Admin, Unusual, NotAnthropic }

    public static class ApiKeys
    {
        // Claude API keys start sk-ant-api03-. Admin keys (sk-ant-admin01-) and other kinds can't call the Messages API.
        public static KeyKind Classify(string key)
        {
            key = (key ?? "").Trim();
            if (key.Length == 0) return KeyKind.Empty;
            if (key.StartsWith("sk-ant-api03-", StringComparison.Ordinal)) return KeyKind.Claude;
            if (key.StartsWith("sk-ant-admin", StringComparison.Ordinal)) return KeyKind.Admin;
            if (key.StartsWith("sk-ant-", StringComparison.Ordinal)) return KeyKind.Unusual;
            return KeyKind.NotAnthropic;
        }
    }
}
