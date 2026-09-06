import crypto from 'node:crypto';
import { googleRequest, googleApi } from './request.js';

/**
 * Google Drive - upload a file, which is multipart and slightly odd.
 *
 * The `drive.file` scope only ever sees files our own app created. That is why
 * it does not trigger Google's restricted-scope review, and it is a good
 * sentence for the report's security section.
 */

const MAX_SIMPLE_UPLOAD = 5 * 1024 * 1024;   // above this, Google wants a resumable upload

export function buildMultipartBody({ fileName, mimeType, fileBuffer, folderId }) {
  if (!Buffer.isBuffer(fileBuffer)) throw new Error('The file must arrive as binary data');
  if (fileBuffer.length > MAX_SIMPLE_UPLOAD) {
    throw new Error(`${fileName} is ${(fileBuffer.length / 1e6).toFixed(1)} MB - use the `
                  + 'resumable endpoint for files over 5 MB');
  }
  const boundary = 'b' + crypto.randomUUID();
  const meta = { name: fileName, ...(folderId ? { parents: [folderId] } : {}) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(meta)),
    Buffer.from(`\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),    // the trailing CRLF matters; without it: 400
  ]);
  return { body, boundary };
}

export const driveNode = {
  description: {
    name: 'googleDrive',
    displayName: 'Google Drive',
    group: 'action',
    icon: 'drive',
    colour: '#1a73e8',
    description: 'Upload a file to Drive, or list what is in a folder',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'googleDrive', required: true }],
    properties: [
      { displayName: 'Operation', name: 'operation', type: 'options', default: 'upload',
        options: [
          { name: 'Upload a file', value: 'upload' },
          { name: 'List a folder', value: 'list' },
        ] },
      { displayName: 'File name', name: 'fileName', type: 'string', default: 'report.txt',
        required: true, displayOptions: { show: { operation: ['upload'] } } },
      { displayName: 'MIME type', name: 'mimeType', type: 'string', default: 'text/plain',
        displayOptions: { show: { operation: ['upload'] } } },
      { displayName: 'File contents', name: 'content', type: 'string', default: '',
        placeholder: '{{ JSON.stringify($json) }}',
        displayOptions: { show: { operation: ['upload'] } } },
      { displayName: 'Folder ID', name: 'folderId', type: 'string', default: '',
        hint: 'Leave empty for the account root' },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    const operation = ctx.getNodeParameter('operation', 0, 'upload');
    const out = [];

    if (operation === 'list') {
      const folderId = ctx.getNodeParameter('folderId', 0, '');
      const query = new URLSearchParams({
        fields: 'files(id,name,mimeType,size,webViewLink)',
        pageSize: '100',
        ...(folderId ? { q: `'${folderId}' in parents and trashed = false` } : { q: 'trashed = false' }),
      });
      const listed = await googleRequest(ctx.credentialId, `${googleApi.drive}/drive/v3/files?${query}`);
      ctx.logger.info(`found ${listed.files?.length ?? 0} file(s)`);
      return [(listed.files ?? []).map((file, i) => ({ json: file, pairedItem: i }))];
    }

    for (let i = 0; i < items.length; i++) {
      const fileName = String(ctx.getNodeParameter('fileName', i, 'file.txt'));
      const mimeType = String(ctx.getNodeParameter('mimeType', i, 'text/plain'));
      const content = ctx.getNodeParameter('content', i, '');
      const folderId = ctx.getNodeParameter('folderId', i, '');

      const { body, boundary } = buildMultipartBody({
        fileName,
        mimeType,
        fileBuffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8'),
        folderId,
      });

      const uploaded = await googleRequest(
        ctx.credentialId,
        `${googleApi.drive}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size`,
        { method: 'POST', body, headers: { 'content-type': `multipart/related; boundary=${boundary}` } },
      );
      ctx.logger.info(`uploaded ${fileName}`);
      out.push({ json: uploaded, pairedItem: i });
    }
    return [out];
  },
};
