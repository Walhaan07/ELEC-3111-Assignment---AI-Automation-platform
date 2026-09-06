import pg from 'pg';
import { config } from './env.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set - copy .env.example to .env first');
  process.exit(1);
}

export const db = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,                          // never open more than 10 sockets to Postgres
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,   // fail fast instead of hanging a request forever
});

// A dead pooled socket fires 'error' with nobody listening, and Node then kills the
// process. One line stops the whole API dying because Postgres restarted.
db.on('error', (err) => console.error('[db] idle client error:', err.message));

export async function withTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();               // ALWAYS - a leaked client is a frozen server at demo time
  }
}
