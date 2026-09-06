#!/usr/bin/env node
/**
 * The doctor - the "why won't it start?" answer machine.
 *
 * Eight people on four operating systems hit the same six problems. The
 * answers are written down here once, so nobody has to ask them in the group
 * chat. `predev` runs this before `npm run dev`, and a non-zero exit is what
 * stops a broken start happening silently.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { config, rootDir } from '../apps/api/env.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

const results = [];
const check = (name, fn, fix) => {
  try {
    results.push(['ok', name, fn() ?? '']);
  } catch (e) {
    results.push([e.soft ? 'warn' : 'fail', name, `${e.message}  ->  ${fix}`]);
  }
};
const soft = (message) => Object.assign(new Error(message), { soft: true });

check('Node 22 or newer', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error(`found v${process.versions.node}`);
  return `v${process.versions.node}`;
}, 'install Node 22 (nvm install 22), then reopen the terminal');

check('Dependencies installed',
  () => {
    if (!fs.existsSync(path.join(rootDir, 'node_modules'))) throw new Error('node_modules is missing');
    return '';
  },
  'run: npm install');

check('.env exists',
  () => {
    if (!fs.existsSync(path.join(rootDir, '.env'))) throw new Error('missing');
    return '';
  },
  'run: cp .env.example .env');

for (const key of ['DATABASE_URL', 'BASE_URL', 'ENCRYPTION_KEY']) {
  check(`${key} is set`, () => {
    if (!process.env[key]) throw new Error('empty');
    if (key === 'ENCRYPTION_KEY') {
      if (!/^[0-9a-f]{64}$/i.test(process.env[key])) throw new Error('must be 64 hex characters');
      if (/^0+$/.test(process.env[key])) {
        throw soft('still the example value - fine for development, never for the server');
      }
    }
    return '';
  }, key === 'ENCRYPTION_KEY'
    ? 'generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    : `fill ${key} in .env - see .env.example`);
}

check('Port 5678 is free', () => {
  const busy = isPortBusy(config.port);
  if (busy) throw soft(`something is already listening on ${config.port}`);
  return `${config.port}`;
}, 'stop the other API, or set PORT in .env');

// --- the database, which is the thing that actually blocks a first run ------
let postgresAnswers = false;
const db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
try {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.tables "
    + "WHERE table_name IN ('workflows','executions','credentials','webhooks','schedules')");
  postgresAnswers = true;
  results.push(['ok', 'Postgres answers', config.databaseUrl.replace(/:[^:@/]*@/, ':****@')]);
  results.push(rows[0].n === 5
    ? ['ok', 'Tables exist', 'workflows, executions, credentials, webhooks, schedules']
    : ['fail', 'Tables exist', `found ${rows[0].n} of 5  ->  run: npm run migrate`]);
} catch (e) {
  results.push(['fail', 'Postgres answers', `${e.message}  ->  run: docker compose up -d --wait`]);
} finally {
  await db.end();
}

// Docker matters only as the way most of us get a database. If Postgres is
// already answering - a local install, a shared server - it is not a problem.
check('Docker is running',
  () => {
    try {
      return execSync('docker info --format "{{.ServerVersion}}"',
                      { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      if (postgresAnswers) throw soft('not running, but Postgres is answering anyway');
      throw new Error('not running');
    }
  },
  'start Docker Desktop and wait for the whale to stop animating, then: docker compose up -d --wait');

for (const [state, name, detail] of results) {
  const badge = state === 'ok' ? `${GREEN} ok ${OFF}`
    : state === 'warn' ? `${YELLOW}warn${OFF}`
      : `${RED}FAIL${OFF}`;
  console.log(`${badge} ${name.padEnd(22)} ${detail}`);
}

const failed = results.filter((r) => r[0] === 'fail').length;
console.log(failed ? `\n${failed} problem(s) - fix the arrows above.` : '\nEverything is ready.');
process.exit(failed ? 1 : 0);      // a non-zero exit is what stops `npm run dev` continuing

function isPortBusy(port) {
  // A synchronous check is not possible, so this is a best-effort probe that
  // never blocks the doctor for more than a moment.
  try {
    const server = net.createServer();
    let busy = false;
    server.on('error', () => { busy = true; });
    server.listen(port, '127.0.0.1');
    const started = Date.now();
    while (!server.listening && !busy && Date.now() - started < 300) { /* spin briefly */ }
    server.close();
    return busy;
  } catch {
    return false;
  }
}
