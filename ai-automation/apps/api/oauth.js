import crypto from 'node:crypto';
import { db } from './db.js';
import { encrypt } from './crypto.js';
import { config } from './env.js';
import { forgetCredential } from '@ai-automation/nodes';

/**
 * The Google permission round trip.
 *
 * We never see anybody's password. The browser goes to Google, Google sends a
 * one-use code back to us, and we trade that code for tokens which are stored
 * encrypted and never sent to a browser again.
 */

export const SCOPES = {
  googleSheets: ['https://www.googleapis.com/auth/spreadsheets'],
  googleDrive: ['https://www.googleapis.com/auth/drive.file'],
  googleDocs: ['https://www.googleapis.com/auth/documents',
               'https://www.googleapis.com/auth/drive.file'],
  gmail: ['https://www.googleapis.com/auth/gmail.send'],
};

export const redirectUri = () => `${config.baseUrl}/rest/oauth2-credential/callback`;

export const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
   <body style="font:16px system-ui;padding:3rem;max-width:34rem;color:#0f172a">
   <h1 style="font-size:1.3rem">${title}</h1><p>${body}</p></body>`;

export function mountOAuth(app, { route, HttpError }) {
  // 1 - send the user to Google, with a state nobody can forge
  app.get('/rest/oauth2-credential/auth', route(async (req, res) => {
    const { type, credentialId } = req.query;
    if (!SCOPES[type]) throw new HttpError(400, `Unknown credential type "${type}"`);
    if (!config.googleReady) {
      throw new HttpError(400, 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in .env');
    }

    const { rows: [cred] } = await db.query('SELECT id FROM credentials WHERE id = $1', [credentialId]);
    if (!cred) throw new HttpError(404, 'Create the credential first, then press Connect');

    // one-use random state, stored with a ten-minute life. This is the CSRF defence:
    // a callback carrying a state we did not issue is thrown away.
    const state = crypto.randomBytes(24).toString('base64url');
    await db.query("INSERT INTO oauth_states (state, credential_id, expires_at) "
                 + "VALUES ($1,$2, now() + interval '10 minutes')", [state, credentialId]);

    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPES[type].join(' '),
      access_type: 'offline',   // REQUIRED, or no long-lived key comes back
      prompt: 'consent',        // REQUIRED when re-authorising
      include_granted_scopes: 'true',
      state,
    }));
  }));

  // 2 - trade the code for keys, and store them scrambled
  app.get('/rest/oauth2-credential/callback', route(async (req, res) => {
    // the user pressed Cancel, or Google refused - say so in words, not a stack trace
    if (req.query.error) {
      return res.status(400).send(page('Not connected',
        req.query.error === 'access_denied'
          ? 'You pressed Cancel on Google’s screen. Nothing was saved.'
          : `Google said: ${req.query.error}`));
    }

    // DELETE ... RETURNING makes the state one-use, atomically
    const { rows: [note] } = await db.query(
      'DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING credential_id',
      [String(req.query.state ?? '')]);
    if (!note) {
      return res.status(400).send(page('Not connected',
        'This link has expired or was not started here. Press Connect again.'));
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        code: String(req.query.code ?? ''),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await response.json();    // { access_token, refresh_token, expires_in, scope }

    if (!response.ok) {
      return res.status(502).send(page('Google refused',
        `${tokens.error}: ${tokens.error_description ?? ''}`));
    }

    // the single most common Phase 5 bug, caught here instead of in three days' time
    if (!tokens.refresh_token) {
      return res.status(400).send(page('Half-connected',
        'Google did not send a refresh token. Remove this app at myaccount.google.com/permissions '
        + 'and press Connect again - access_type=offline only returns one on a fresh consent.'));
    }

    await db.query('UPDATE credentials SET data = $1, scopes = $2, expires_at = $3 WHERE id = $4',
      [encrypt(JSON.stringify(tokens)),
       (tokens.scope ?? '').split(' ').filter(Boolean),
       new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000),
       note.credential_id]);
    forgetCredential(note.credential_id);    // drop any cached access token for it

    res.send(page('Connected', 'You can close this window.'));
  }));
}
