import { db } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { useCredentialStore } from '@ai-automation/nodes';

/**
 * The bridge between the database and the Google helper.
 *
 * `packages/nodes` must not import `apps/api` - that would make the node
 * package impossible to test without Postgres. Instead the API installs a
 * store into it at boot, and the helper asks that store for tokens.
 */
export function connectCredentialStore() {
  useCredentialStore({
    async load(credentialId) {
      const { rows: [row] } = await db.query('SELECT data FROM credentials WHERE id = $1', [credentialId]);
      if (!row?.data) return null;
      return JSON.parse(decrypt(row.data));
    },
    async save(credentialId, tokens, expiresAt) {
      await db.query('UPDATE credentials SET data = $1, expires_at = $2 WHERE id = $3',
                     [encrypt(JSON.stringify(tokens)), expiresAt, credentialId]);
    },
  });
}

/**
 * Non-OAuth credentials (the AI node's API key) are handed to the engine as
 * plain values, decrypted once per run and never written to the execution row.
 */
export async function loadRunCredentials(workflow) {
  const ids = [...new Set((workflow.nodes ?? []).map((n) => n.credentials?.id).filter(Boolean))];
  if (ids.length === 0) return {};

  const { rows } = await db.query('SELECT id, type, data FROM credentials WHERE id = ANY($1::uuid[])', [ids]);
  const out = {};
  for (const row of rows) {
    if (row.type !== 'anthropicApi' || !row.data) continue;   // OAuth tokens stay inside the helper
    try {
      out[row.type] = JSON.parse(decrypt(row.data));
    } catch {
      // a credential that cannot be decrypted must not stop unrelated nodes running
    }
  }
  return out;
}
