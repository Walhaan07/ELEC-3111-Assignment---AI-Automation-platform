#!/usr/bin/env node
/**
 * Create the tables, and optionally the starter workflow.
 *
 *   npm run migrate      schema only
 *   npm run seed         schema + the "Hello weather" example
 *
 * Uses the same pg client the API uses, so there is no need for psql to be
 * installed on eight different laptops.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config, rootDir } from '../apps/api/env.js';

const withSeed = process.argv.includes('--seed');

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set - copy .env.example to .env first');
  process.exit(1);
}

const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  await client.query(fs.readFileSync(path.join(rootDir, 'schema.sql'), 'utf8'));
  console.log('schema applied');

  if (withSeed) {
    await client.query(fs.readFileSync(path.join(rootDir, 'seed.sql'), 'utf8'));
    console.log('seed applied');
  }

  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('tables:', rows.map((r) => r.table_name).join(', '));
} catch (err) {
  console.error('migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
