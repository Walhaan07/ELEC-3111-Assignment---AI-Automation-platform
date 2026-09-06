import crypto from 'node:crypto';
import { config } from './env.js';

/**
 * Encryption you can trust, in twenty-five lines.
 *
 * GCM is the "authenticated" mode of AES: it does not only hide the token, it
 * detects tampering. Change one byte in the database and final() throws instead
 * of quietly returning rubbish. That is what the `tag` field is for.
 */

const raw = config.encryptionKey;
if (!/^[0-9a-f]{64}$/i.test(raw)) {
  console.error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  console.error('Generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);                  // fail at boot, not at 2 a.m. during the demo
}
const key = Buffer.from(raw, 'hex');

// version the envelope: if we ever change algorithm, old rows still decrypt
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(envelope) {
  if (!envelope || envelope.v !== 1) throw new Error('Unknown credential format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Credential could not be decrypted - has ENCRYPTION_KEY changed?');
  }
}
