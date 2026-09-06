import { googleRequest, googleApi } from './request.js';

/**
 * Google Docs - copy the template, then mail-merge the copy.
 *
 * Never write into the template itself. Copy it with Drive first, then replace
 * every placeholder in ONE batchUpdate, which Google applies atomically: all of
 * them, or none.
 */
export const docsNode = {
  description: {
    name: 'googleDocs',
    displayName: 'Google Docs',
    group: 'action',
    icon: 'doc',
    colour: '#4285f4',
    description: 'Copy a template document and fill in its placeholders',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'googleDocs', required: true }],
    properties: [
      { displayName: 'Template document ID', name: 'templateId', type: 'string', default: '',
        required: true, placeholder: '1aBcD...',
        hint: 'The document is copied first, so the template itself is never edited' },
      { displayName: 'Name for the copy', name: 'docName', type: 'string', default: 'Document',
        required: true, placeholder: 'Invoice {{ $json.orderId }}' },
      { displayName: 'Replacements', name: 'replacements', type: 'json', default: '{}',
        hint: 'Each key replaces {{key}} in the document, e.g. { "customer_name": "{{ $json.name }}" }' },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const out = [];

    for (let i = 0; i < items.length; i++) {
      const templateId = String(ctx.getNodeParameter('templateId', i));
      const docName = String(ctx.getNodeParameter('docName', i, 'Document'));
      const raw = ctx.getNodeParameter('replacements', i, {});
      const replacements = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;

      if (Object.keys(replacements).length === 0) {
        throw new Error('No replacements were given - the copy would be blank');
      }

      // 1 - never write into the template itself: copy it with Drive first
      const copy = await googleRequest(
        ctx.credentialId,
        `${googleApi.drive}/drive/v3/files/${templateId}/copy`,
        { method: 'POST',
          body: JSON.stringify({ name: `${docName} - ${new Date().toISOString().slice(0, 10)}` }) },
      );

      // 2 - one batchUpdate replaces every placeholder atomically
      const requests = Object.entries(replacements).map(([k, v]) => ({
        replaceAllText: {
          containsText: { text: `{{${k}}}`, matchCase: true },
          replaceText: v === null || v === undefined ? '' : String(v),
        },
      }));

      const result = await googleRequest(
        ctx.credentialId,
        `${googleApi.docs}/v1/documents/${copy.id}:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ requests }) },
      );

      // 3 - tell the user how many placeholders actually matched. A zero here is a typo.
      const replaced = (result.replies ?? [])
        .reduce((n, r) => n + (r.replaceAllText?.occurrencesChanged ?? 0), 0);
      if (replaced === 0) ctx.logger.warn('no placeholder matched - check the {{names}} in the template');
      ctx.logger.info(`replaced ${replaced} placeholder(s) in ${copy.id}`);

      out.push({
        json: {
          documentId: copy.id,
          replaced,
          url: `https://docs.google.com/document/d/${copy.id}/edit`,
        },
        pairedItem: i,
      });
    }
    return [out];
  },
};
