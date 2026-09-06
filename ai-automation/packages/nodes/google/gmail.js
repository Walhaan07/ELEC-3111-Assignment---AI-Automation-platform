import crypto from 'node:crypto';
import { googleRequest, googleApi } from './request.js';

/**
 * Gmail - build the message by hand, then base64url it.
 *
 * The only genuinely fiddly node. Knowing that in advance stops it feeling
 * like failure. Three things bite: non-English characters in the subject,
 * addresses that are not addresses, and attachments over Gmail's limit.
 */

const MAX_MESSAGE = 35 * 1024 * 1024;          // Gmail's hard limit for a send

// "Résumé" in a Subject: header is illegal ASCII. RFC 2047 is how you smuggle it through.
export const encodeHeader = (s) =>
  /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

const isEmail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(s).trim());

export function addressList(value, field) {
  const list = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Error(`${field} is empty`);
  const bad = list.filter((a) => !isEmail(a));
  if (bad.length) throw new Error(`${field} contains an invalid address: ${bad[0]}`);
  return list.join(', ');
}

export function buildMime({ to, cc, subject, html, text, attachments = [], inReplyTo }) {
  const b = 'x' + crypto.randomUUID();
  const headers = [
    `To: ${addressList(to, 'To')}`,
    cc ? `Cc: ${addressList(cc, 'Cc')}` : null,
    `Subject: ${encodeHeader(subject ?? '(no subject)')}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,     // makes it a reply, not a new thread
    inReplyTo ? `References: ${inReplyTo}` : null,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
  ].filter(Boolean).join('\r\n');

  const bodyPart =
    `--${b}\r\nContent-Type: text/html; charset="UTF-8"\r\n`
    + 'Content-Transfer-Encoding: base64\r\n\r\n'
    + `${Buffer.from(html ?? text ?? '', 'utf8').toString('base64')}\r\n`;

  const fileParts = attachments.map((a) =>
    `--${b}\r\nContent-Type: ${a.mimeType || 'application/octet-stream'}\r\n`
    + `Content-Disposition: attachment; filename="${String(a.fileName).replace(/"/g, '')}"\r\n`
    + `Content-Transfer-Encoding: base64\r\n\r\n${a.data}\r\n`).join('');

  const mime = `${headers}\r\n\r\n${bodyPart}${fileParts}--${b}--\r\n`;
  if (Buffer.byteLength(mime) > MAX_MESSAGE) {
    throw new Error('That message is over Gmail’s 35 MB limit - put the file in Drive and link it');
  }
  return mime;
}

export const base64url = (s) =>
  Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const gmailNode = {
  description: {
    name: 'gmail',
    displayName: 'Gmail',
    group: 'action',
    icon: 'mail',
    colour: '#ea4335',
    description: 'Send an email from the connected Google account',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'gmail', required: true }],
    properties: [
      { displayName: 'To', name: 'to', type: 'string', default: '', required: true,
        placeholder: 'someone@example.com, someone.else@example.com' },
      { displayName: 'Cc', name: 'cc', type: 'string', default: '' },
      { displayName: 'Subject', name: 'subject', type: 'string', default: '', required: true,
        placeholder: 'Order {{ $json.orderId }} received' },
      { displayName: 'Message (HTML allowed)', name: 'html', type: 'text', default: '',
        placeholder: '<p>Hello {{ $json.name }},</p>' },
      { displayName: 'Reply to message ID', name: 'inReplyTo', type: 'string', default: '',
        hint: 'Set this to keep the email in an existing thread' },
      { displayName: 'Dry run', name: 'dryRun', type: 'boolean', default: false,
        hint: 'Render and validate the message without sending it - rehearse the demo safely' },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const mime = buildMime({
        to: ctx.getNodeParameter('to', i),
        cc: ctx.getNodeParameter('cc', i, ''),
        subject: ctx.getNodeParameter('subject', i, '(no subject)'),
        html: ctx.getNodeParameter('html', i, ''),
        inReplyTo: ctx.getNodeParameter('inReplyTo', i, '') || null,
      });

      // dry run is a real feature: the whole workflow can be tested a hundred times
      // without a hundred emails arriving at a real person
      if (ctx.getNodeParameter('dryRun', i, false)) {
        ctx.logger.info('dry run - nothing was sent');
        out.push({ json: { dryRun: true, preview: mime.slice(0, 400) }, pairedItem: i });
        continue;
      }

      const sent = await googleRequest(
        ctx.credentialId,
        `${googleApi.gmail}/gmail/v1/users/me/messages/send`,
        { method: 'POST', body: JSON.stringify({ raw: base64url(mime) }) },
      );
      ctx.logger.info(`sent ${sent.id}`);
      out.push({ json: { messageId: sent.id, threadId: sent.threadId }, pairedItem: i });
    }
    return [out];
  },
};
