import { test, expect, describe } from 'vitest';
import { manualTrigger, webhookTrigger, scheduleTrigger } from './triggers.js';

/**
 * The three ways a workflow starts.
 *
 * A trigger has one job: hand the rest of the workflow an item of the right
 * shape, whether a real request started the run or somebody pressed Run while
 * building it.
 */
const ctxFor = (items, parameters = {}) => ({
  getInputData: () => items,
  getNodeParameter: (name, _i, fallback) => parameters[name] ?? fallback,
  logger: { info() {}, warn() {} },
});

describe('Manual Trigger', () => {
  test('emits one empty item', async () => {
    const [out] = await manualTrigger.execute(ctxFor([]));
    expect(out).toEqual([{ json: {} }]);
  });

  test('passes on whatever the run was given', async () => {
    const [out] = await manualTrigger.execute(ctxFor([{ json: { seeded: true } }]));
    expect(out[0].json.seeded).toBe(true);
  });
});

describe('Webhook', () => {
  test('a real request passes straight through', async () => {
    const arrived = [{ json: { body: { customer: 'Alice' }, method: 'POST', headers: {}, query: {} } }];
    const [out] = await webhookTrigger.execute(ctxFor(arrived));
    expect(out[0].json.body.customer).toBe('Alice');
  });

  // The bug this prevents: pressing Run while building a webhook workflow used
  // to hand every downstream node {} , so {{ $json.body.customer }} threw
  // "cannot read properties of undefined" before a request had ever been sent.
  test('pressing Run by hand still produces the documented shape', async () => {
    const [out] = await webhookTrigger.execute(ctxFor([], { method: 'PUT' }));
    expect(Object.keys(out[0].json).sort())
      .toEqual(['body', 'headers', 'method', 'query', 'receivedAt']);
    expect(out[0].json.method).toBe('PUT');
    expect(out[0].json.body).toEqual({});
    expect(() => out[0].json.body.customer).not.toThrow();
  });

  test('the trigger item shape is the one every workflow reads', async () => {
    const [out] = await webhookTrigger.execute(ctxFor([{ json: {} }]));
    expect(out[0].json).toHaveProperty('headers');
    expect(out[0].json).toHaveProperty('query');
    expect(out[0].json).toHaveProperty('body');
  });
});

describe('Schedule', () => {
  test('a tick carries when it fired', async () => {
    const [out] = await scheduleTrigger.execute(ctxFor([]));
    expect(out[0].json).toHaveProperty('timestamp');
    expect(new Date(out[0].json.timestamp).getTime()).not.toBeNaN();
  });

  test('the scheduler’s own payload is passed on untouched', async () => {
    const fired = [{ json: { timestamp: '2026-03-14T09:00:00.000Z', scheduledFor: '2026-03-14T09:00:00.000Z' } }];
    const [out] = await scheduleTrigger.execute(ctxFor(fired));
    expect(out[0].json.scheduledFor).toBe('2026-03-14T09:00:00.000Z');
  });
});
