import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { runById } from './runner.js';
import { lastNodeOutput } from '@ai-automation/engine';

/**
 * The webhook route - the one endpoint strangers can reach.
 *
 * Everything else in this project sits behind our own editor. This does not.
 * Treat every line of it as hostile input, because it is.
 */

// keep the raw bytes: a signature is computed over the exact body, not over re-encoded JSON
const rawJson = express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
});

// a form post is a perfectly ordinary way for a webhook to arrive
const rawForm = express.urlencoded({
  extended: false,
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
});

const hookLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests' },
});

export function mountWebhooks(app) {
  app.all('/webhook/:path', hookLimit, rawJson, rawForm, async (req, res) => {
    try {
      const isTest = req.query.test === '1';
      const { rows: [hook] } = await db.query(
        'SELECT * FROM webhooks WHERE path = $1 AND method = $2 AND is_test = $3',
        [req.params.path, req.method, isTest]);

      if (!hook) return res.status(404).json({ message: 'No workflow is listening here' });

      // optional shared secret, compared in constant time so timing cannot leak it
      if (hook.secret) {
        const expected = crypto.createHmac('sha256', decrypt(hook.secret))
          .update(req.rawBody ?? Buffer.alloc(0)).digest('hex');
        const given = String(req.get('x-signature') ?? '');
        const ok = given.length === expected.length
          && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
        if (!ok) return res.status(401).json({ message: 'Bad or missing signature' });
      }

      // deduplicate retries from the sender: Stripe, GitHub and Shopify all retry
      // a webhook they think failed, and the work must not happen twice
      const key = req.get('idempotency-key') || req.get('x-github-delivery');
      if (key) {
        const { rows } = await db.query(
          'SELECT execution_id FROM webhook_deliveries WHERE idempotency_key = $1', [key]);
        if (rows[0]) {
          return res.status(200).json({ message: 'Already handled', executionId: rows[0].execution_id });
        }
      }

      const triggerItems = [{
        json: {
          headers: req.headers,
          query: req.query,
          body: req.body ?? {},
          method: req.method,
          receivedAt: new Date().toISOString(),
        },
      }];

      if (hook.response_mode === 'immediately') {
        res.status(202).json({ message: 'Workflow was started' });     // answer in ~5 ms
        runById(hook.workflow_id, triggerItems, 'webhook')
          .then((r) => key && remember(key, r.executionId))
          .catch((err) => console.error('[webhook]', err.message));    // never crash the process
        return;
      }

      const result = await runById(hook.workflow_id, triggerItems, 'webhook');
      if (key) await remember(key, result.executionId);
      return res.json(lastNodeOutput(result.results));
    } catch (err) {
      console.error('[webhook]', err.message);
      return res.status(500).json({
        message: 'The workflow failed',
        error: err.payload?.message ?? err.message,
        executionId: err.executionId ?? null,
      });
    }
  });
}

const remember = (key, executionId) => db.query(
  'INSERT INTO webhook_deliveries (idempotency_key, execution_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
  [key, executionId]);
