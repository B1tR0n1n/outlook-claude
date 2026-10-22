// Prompt building for Claude for Outlook. Pure functions: no Office, no DOM.
// ES5 only. Older classic Outlook builds host add-ins in Internet Explorer 11.
(function (root) {
  'use strict';

  var MAX_BODY_CHARS = 60000;

  var BASE_SYSTEM =
    'You help the user read and write email inside Microsoft Outlook. ' +
    'Reply in plain text only: no Markdown, no asterisks, no headings, no code fences. ' +
    'Use short paragraphs and simple hyphen bullets when a list helps. ' +
    'When you write an email, write only the body. No subject line, and no notes ' +
    'before or after it. End with the user\'s sign-off only if their context gives one. ' +
    'Never invent facts, dates, prices or commitments the source does not contain. ' +
    'Where the user must supply something, write [like this].';

  var READ_ACTIONS = {
    summarize: 'Summarize this email (and any quoted thread) in 3 to 6 short bullets. ' +
      'Lead with what is being asked of the user, if anything.',
    actions: 'List every action item, request, deadline and open question in this email. ' +
      'For each, say who owns it and any date. If there are none, say so in one line.',
    reply: 'Draft a reply to this email from the user.'
  };

  var COMPOSE_ACTIONS = {
    improve: 'Improve this email text: clearer, tighter, correct grammar. Keep the meaning, ' +
      'the facts and the user\'s voice. Return only the revised text.',
    shorten: 'Rewrite this email text at about half the length. Keep every fact and request. ' +
      'Return only the revised text.',
    professional: 'Rewrite this email text in a professional, direct tone suitable for a client. ' +
      'Return only the revised text.',
    friendly: 'Rewrite this email text in a warmer, friendlier tone without losing substance. ' +
      'Return only the revised text.',
    draft: 'Turn these notes into a complete, ready-to-send email body. Return only the email.'
  };

  function system(userContext) {
    var ctx = (userContext || '').replace(/^\s+|\s+$/g, '');
    return ctx ? BASE_SYSTEM + '\n\nAbout the user: ' + ctx : BASE_SYSTEM;
  }

  function clip(text) {
    text = text || '';
    if (text.length <= MAX_BODY_CHARS) return text;
    return text.slice(0, MAX_BODY_CHARS) + '\n\n[... truncated: the email continues past this point]';
  }

  function people(list) {
    if (!list || !list.length) return '';
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      out.push(p.displayName && p.emailAddress
        ? p.displayName + ' <' + p.emailAddress + '>'
        : (p.displayName || p.emailAddress || ''));
    }
    return out.join(', ');
  }

  // msg: { subject, from, to, cc, date, body } as read from Office.context.mailbox.item
  function emailBlock(msg) {
    var lines = ['<email>'];
    if (msg.subject) lines.push('Subject: ' + msg.subject);
    if (msg.from) lines.push('From: ' + people([msg.from]));
    if (msg.to && msg.to.length) lines.push('To: ' + people(msg.to));
    if (msg.cc && msg.cc.length) lines.push('Cc: ' + people(msg.cc));
    if (msg.date) lines.push('Date: ' + msg.date);
    lines.push('', clip(msg.body), '</email>');
    return lines.join('\n');
  }

  function withInstructions(task, extra) {
    var e = (extra || '').replace(/^\s+|\s+$/g, '');
    return e ? task + '\n\nThe user\'s instructions: ' + e : task;
  }

  // action: summarize | actions | reply | ask
  function buildRead(action, msg, extra) {
    if (action === 'ask') {
      if (!extra) throw new Error('Type a question first.');
      return emailBlock(msg) + '\n\n' + extra;
    }
    var task = READ_ACTIONS[action];
    if (!task) throw new Error('Unknown action: ' + action);
    return emailBlock(msg) + '\n\n' + withInstructions(task, extra);
  }

  // action: improve | shorten | professional | friendly | draft | ask
  function buildCompose(action, text, extra, context) {
    if (!text || !/\S/.test(text)) throw new Error('There is no text to work on. Write something or select it first.');
    var task = action === 'ask' ? extra : COMPOSE_ACTIONS[action];
    if (action === 'ask' && !extra) throw new Error('Type an instruction first.');
    if (!task) throw new Error('Unknown action: ' + action);
    var parts = [];
    if (context && context.subject) parts.push('Subject of this email: ' + context.subject);
    parts.push('<text>\n' + clip(text) + '\n</text>');
    parts.push(action === 'ask' ? task : withInstructions(task, extra));
    return parts.join('\n\n');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Plain text to email HTML: blank lines split paragraphs, single newlines become <br>.
  function textToHtml(text) {
    var paras = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      if (!/\S/.test(paras[i])) continue;
      out.push('<p>' + escapeHtml(paras[i]).replace(/\n/g, '<br>') + '</p>');
    }
    return out.join('');
  }

  var api = {
    MAX_BODY_CHARS: MAX_BODY_CHARS,
    READ_ACTIONS: READ_ACTIONS,
    COMPOSE_ACTIONS: COMPOSE_ACTIONS,
    system: system,
    buildRead: buildRead,
    buildCompose: buildCompose,
    textToHtml: textToHtml,
    escapeHtml: escapeHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Prompts = api;
})(this);
