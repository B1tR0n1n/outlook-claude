// Thunderbird message and draft helpers. Pure: no messenger API, and DOM work takes a DOMParser,
// so the same code runs in the panel and under jsdom in the tests.
(function (root) {
  'use strict';

  const Prompts = typeof module !== 'undefined' && module.exports ? require('../src/prompts.js') : root.Prompts;

  // Where the user's own text ends in a Thunderbird HTML draft: the quoted thread, the signature,
  // or a forwarded message.
  const BOUNDARY = '.moz-cite-prefix, blockquote[type="cite"], .moz-signature, .moz-forward-container';
  const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TABLE|BLOCKQUOTE|PRE|HR)$/;

  // header: messages.MessageHeader. Thunderbird gives people as "Name <addr>" strings.
  function emailInfo(header, body) {
    const h = header || {};
    const person = (s) => ({ displayName: s });
    return {
      subject: h.subject || '',
      from: h.author ? person(h.author) : null,
      to: (h.recipients || []).map(person),
      cc: (h.ccList || []).map(person),
      date: h.date ? new Date(h.date).toString() : '',
      body: body || ''
    };
  }

  // parts: messages.InlineTextPart[]. Plain text wins; HTML only when there is no plain part.
  function pickText(parts) {
    const of = (type) => (parts || []).filter((p) => p && /\S/.test(p.content || '') &&
      String(p.contentType || '').toLowerCase().indexOf(type) === 0);
    const plain = of('text/plain');
    if (plain.length) return { type: 'plain', content: plain.map((p) => p.content).join('\n\n') };
    const html = of('text/html');
    if (html.length) return { type: 'html', content: html.map((p) => p.content).join('\n') };
    return null;
  }

  // Readable text from DOM nodes: <br> and block ends become line breaks, paragraphs get a blank line.
  function textOf(nodes) {
    let out = '';
    const newline = () => { if (out && !/\n$/.test(out)) out += '\n'; };
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.data.replace(/[\s ]+/g, ' '); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD') return;
      if (tag === 'BR') { out += '\n'; return; }
      const block = BLOCK.test(tag);
      if (block) newline();
      Array.prototype.forEach.call(n.childNodes, walk);
      if (block) newline();
      if (tag === 'P') out += '\n';
    };
    Array.prototype.forEach.call(nodes, walk);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function htmlToText(html, parser) {
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    return textOf(doc.body ? doc.body.childNodes : []);
  }

  const isBoundary = (n) => n.nodeType === 1 && (n.matches(BOUNDARY) || !!n.querySelector(BOUNDARY));

  // The user's own part of an HTML draft: the top-level body nodes before the quote or signature.
  function splitDraftHtml(html, parser) {
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const own = [];
    let boundary = null;
    for (const n of Array.prototype.slice.call(doc.body.childNodes)) {
      if (isBoundary(n)) { boundary = n; break; }
      own.push(n);
    }
    return { doc, own, boundary, text: textOf(own) };
  }

  function serialize(doc) {
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  // The DOM version of Prompts.textToHtml: blank lines split paragraphs, single newlines become <br>.
  function fragment(doc, text) {
    return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).filter((p) => /\S/.test(p)).map((para) => {
      const p = doc.createElement('p');
      para.split('\n').forEach((line, i) => {
        if (i) p.appendChild(doc.createElement('br'));
        p.appendChild(doc.createTextNode(line));
      });
      return p;
    });
  }

  // Swap the user's own text for newText, keeping the quoted thread and signature.
  function replaceOwnHtml(html, newText, parser) {
    const split = splitDraftHtml(html, parser);
    for (const n of split.own) n.parentNode.removeChild(n);
    const body = split.doc.body;
    for (const n of fragment(split.doc, newText)) body.insertBefore(n, split.boundary);
    return serialize(split.doc);
  }

  // Put newText at the top of a draft (a fresh reply), above the quote.
  function insertAtStartHtml(html, newText, parser) {
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const first = doc.body.firstChild;
    for (const n of fragment(doc, newText)) doc.body.insertBefore(n, first);
    return serialize(doc);
  }

  // Plain-text drafts: own text ends at the "-- " signature line, a forwarded/original message
  // banner, or the "... wrote:" line above the first quoted (">") line.
  function splitDraftPlain(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let cut = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l === '-- ' || /^-{4,} ?(Forwarded|Original) Message ?-{4,}$/i.test(l.trim())) { cut = i; break; }
      if (/^>/.test(l)) { cut = i > 0 && /:\s*$/.test(lines[i - 1]) ? i - 1 : i; break; }
    }
    return { own: lines.slice(0, cut).join('\n').replace(/\s+$/, ''), rest: lines.slice(cut).join('\n') };
  }

  function replaceOwnPlain(text, newText) {
    const split = splitDraftPlain(text);
    return split.rest ? newText + '\n\n' + split.rest : newText;
  }

  function insertAtStartPlain(text, newText) {
    return newText + '\n\n' + String(text || '');
  }

  function systemPrompt(userContext) {
    return Prompts.system(userContext).replace('inside Microsoft Outlook', 'inside Thunderbird');
  }

  // null when the key looks usable, else what is wrong with it.
  function keyProblem(key) {
    if (!key) return 'Paste your Anthropic API key first.';
    if (key.indexOf('sk-ant-admin') === 0) {
      return 'That is an Admin key (sk-ant-admin01-). Admin keys manage an organization and cannot call Claude. ' +
        'Create a Claude API key (sk-ant-api03-) at platform.claude.com.';
    }
    if (key.indexOf('sk-ant-') !== 0) return 'That doesn\'t look like an Anthropic API key (sk-ant-api03-...).';
    return null;
  }

  const api = {
    emailInfo, pickText, htmlToText, splitDraftHtml, replaceOwnHtml, insertAtStartHtml,
    splitDraftPlain, replaceOwnPlain, insertAtStartPlain, systemPrompt, keyProblem
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClaudeMail = api;
})(this);
