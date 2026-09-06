import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

// One place that loads .env, so every entry point - the server, the doctor,
// the migration script - reads exactly the same settings.
const here = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(here, '../..');

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

export const config = {
  port: Number(process.env.PORT ?? 5678),
  databaseUrl: process.env.DATABASE_URL,
  baseUrl: process.env.BASE_URL ?? 'http://localhost:5678',
  editorOrigin: process.env.EDITOR_ORIGIN ?? 'http://localhost:5173',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  // A missing Google client is not fatal: the platform runs, and only the
  // Connect button says why it cannot work yet.
  get googleReady() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
                   && !String(process.env.GOOGLE_CLIENT_ID).startsWith('replace-me'));
  },
};
