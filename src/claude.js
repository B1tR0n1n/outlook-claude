// Minimal Claude Messages API client. ES5 + XMLHttpRequest, callbacks only.
// No fetch and no Promise, because older classic Outlook runs add-ins in IE11.
(function (root) {
  'use strict';

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var API_VERSION = '2023-06-01';
  var TIMEOUT_MS = 180000;

  var MODELS = [
    { id: 'claude-opus-5-5', label: 'Opus 5.5 (best)' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (faster)' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest)' }
  ];
  var DEFAULT_MODEL = MODELS[0].id;

  function friendlyError(status, body) {
    var detail = '';
    try { detail = (JSON.parse(body).error || {}).message || ''; } catch (e) { detail = ''; }
    if (status === 0) return 'Could not reach api.anthropic.com. Check the network or proxy, or whether a firewall blocks it.';
    if (status === 401) return 'The API key was rejected. Open Settings and re-enter it.';
    if (status === 403) return 'This API key is not allowed to do that' + (detail ? ': ' + detail : '.');
    if (status === 404) return 'Model not found' + (detail ? ': ' + detail : '.') + ' Pick another model in Settings.';
    if (status === 413) return 'The email is too large to send.';
    if (status === 429) return 'Rate limited or out of credit' + (detail ? ': ' + detail : '.');
    if (status >= 500) return 'Anthropic API error ' + status + '. Try again in a minute.';
    return 'Request failed (' + status + ')' + (detail ? ': ' + detail : '.');
  }

  // Returns { text } on success, { error } otherwise.
  function parseResponse(status, body) {
    if (status !== 200) return { error: friendlyError(status, body) };
    var data;
    try { data = JSON.parse(body); } catch (e) { return { error: 'Unreadable response from the API.' }; }
    var parts = [];
    var content = data.content || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].type === 'text') parts.push(content[i].text);
    }
    var text = parts.join('').replace(/^\s+|\s+$/g, '');
    if (!text) return { error: 'Claude returned no text' + (data.stop_reason ? ' (' + data.stop_reason + ')' : '') + '.' };
    if (data.stop_reason === 'max_tokens') text += '\n\n[cut off: reached the length limit]';
    return { text: text };
  }

  // opts: { apiKey, model, system, prompt, maxTokens }; cb(result). Returns the xhr.
  function send(opts, cb, makeXhr) {
    if (!opts.apiKey) { cb({ error: 'No API key yet. Open Settings and paste your Anthropic API key.' }); return null; }
    var xhr = makeXhr ? makeXhr() : new XMLHttpRequest();
    var done = false;
    function finish(result) { if (!done) { done = true; cb(result); } }

    xhr.open('POST', ENDPOINT, true);
    xhr.timeout = TIMEOUT_MS;
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.setRequestHeader('x-api-key', opts.apiKey);
    xhr.setRequestHeader('anthropic-version', API_VERSION);
    // Required for calls straight from a browser; the key is the user's own.
    xhr.setRequestHeader('anthropic-dangerous-direct-browser-access', 'true');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) finish(parseResponse(xhr.status, xhr.responseText));
    };
    xhr.ontimeout = function () { finish({ error: 'Timed out waiting for Claude. Try again or pick a faster model.' }); };
    xhr.send(JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens || 4096,
      system: opts.system,
      messages: [{ role: 'user', content: opts.prompt }]
    }));
    return xhr;
  }

  var api = {
    ENDPOINT: ENDPOINT, API_VERSION: API_VERSION, MODELS: MODELS, DEFAULT_MODEL: DEFAULT_MODEL,
    parseResponse: parseResponse, send: send
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Claude = api;
})(this);
