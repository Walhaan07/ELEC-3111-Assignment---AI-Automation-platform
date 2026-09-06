import { googleRequest, googleApi } from './request.js';

/**
 * Google Sheets - append every item in ONE request.
 *
 * The obvious version sends one request per item. Fifty items is fifty round
 * trips and a rate limit. Collect first, send once - and it is measurable, so
 * the report measures it.
 */

// "Sheet1" is fine; "Q3 Orders" and "Bob's list" are not, until they are quoted
export const quoteSheetName = (name) => `'${String(name).replace(/'/g, "''")}'`;

// accepts a full URL or a bare id, and says so clearly when it is neither
export function parseSheetId(value) {
  const s = String(value ?? '').trim();
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  const id = fromUrl ?? s;
  if (!/^[a-zA-Z0-9-_]{10,}$/.test(id)) throw new Error(`"${s}" is not a spreadsheet id or URL`);
  return id;
}

export const sheetsNode = {
  description: {
    name: 'googleSheets',
    displayName: 'Google Sheets',
    group: 'action',
    icon: 'sheet',
    colour: '#0a7a70',
    description: 'Append rows to, or read rows from, a spreadsheet',
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'googleSheets', required: true }],
    properties: [
      { displayName: 'Operation', name: 'operation', type: 'options', default: 'append',
        options: [
          { name: 'Append rows', value: 'append' },
          { name: 'Read rows', value: 'read' },
        ] },
      { displayName: 'Spreadsheet URL or ID', name: 'documentId', type: 'string', default: '',
        required: true, placeholder: 'https://docs.google.com/spreadsheets/d/...' },
      { displayName: 'Sheet name', name: 'sheetName', type: 'string', default: 'Sheet1', required: true },
      { displayName: 'Columns', name: 'columns', type: 'json', default: '{}',
        hint: 'One key per column header, e.g. { "name": "{{ $json.name }}" }',
        displayOptions: { show: { operation: ['append'] } } },
    ],
  },

  async execute(ctx) {
    const items = ctx.getInputData();
    if (items.length === 0) return [[]];

    const operation = ctx.getNodeParameter('operation', 0, 'append');
    const id = parseSheetId(ctx.getNodeParameter('documentId', 0));
    const sheet = quoteSheetName(ctx.getNodeParameter('sheetName', 0, 'Sheet1'));
    const valuesUrl = (range, suffix = '', query = '') =>
      `${googleApi.sheets}/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}${suffix}${query}`;

    if (operation === 'read') {
      const read = await googleRequest(ctx.credentialId, valuesUrl(`${sheet}!A:Z`));
      const [header = [], ...rows] = read.values ?? [];
      ctx.logger.info(`read ${rows.length} row(s)`);
      return [rows.map((row, i) => ({
        json: Object.fromEntries(header.map((name, c) => [name || `column${c + 1}`, row[c] ?? ''])),
        pairedItem: 0,
        ...(i === 0 ? {} : {}),
      }))];
    }

    // read the header row once, so column order follows the sheet, not the object
    const header = await googleRequest(ctx.credentialId, valuesUrl(`${sheet}!1:1`));
    const columns = header.values?.[0] ?? null;

    const values = items.map((_, i) => {
      const row = ctx.getNodeParameter('columns', i, {});   // { name, email, ... }
      const parsed = typeof row === 'string' ? JSON.parse(row || '{}') : row;
      return columns ? columns.map((c) => stringify(parsed[c])) : Object.values(parsed).map(stringify);
    });

    // Sheets caps a write at 10 MB / ~10 000 rows; chunk so a big run cannot fail as a whole
    const responses = [];
    for (let start = 0; start < values.length; start += 500) {
      responses.push(await googleRequest(
        ctx.credentialId,
        valuesUrl(`${sheet}!A:Z`, ':append', '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS'),
        { method: 'POST', body: JSON.stringify({ values: values.slice(start, start + 500) }) },
      ));
    }

    ctx.logger.info(`appended ${values.length} row(s) in ${responses.length} request(s)`);
    return [items.map((item, i) => ({
      json: { ...item.json, updatedRange: responses[0]?.updates?.updatedRange ?? null },
      pairedItem: i,
    }))];
  },
};

const stringify = (v) =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
