import { db, withTransaction } from './db.js';
import { nodeTypes } from '@ai-automation/nodes';
import { validateWorkflow } from '@ai-automation/engine';
import { activate, deactivate, validateSchedule } from './schedules.js';

/**
 * Turning a workflow on.
 *
 * Activating is the moment a drawing becomes a running thing: its webhook
 * address is claimed and its timer is registered. Both happen in one
 * transaction, so a workflow can never end up half on.
 */

const TRIGGERS = { webhook: 'webhook', schedule: 'schedule' };

export function findTriggerNode(workflow) {
  return (workflow.nodes ?? []).find((n) => nodeTypes[n.type]?.description?.group === 'trigger') ?? null;
}

export async function setActive(workflowId, active) {
  const { rows: [wf] } = await db.query('SELECT * FROM workflows WHERE id = $1', [workflowId]);
  if (!wf) throw Object.assign(new Error('No workflow with that id'), { status: 404 });

  if (!active) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM webhooks WHERE workflow_id = $1', [workflowId]);
      await client.query('DELETE FROM schedules WHERE workflow_id = $1', [workflowId]);
      await client.query('UPDATE workflows SET active = false WHERE id = $1', [workflowId]);
    });
    deactivate(workflowId);
    return { active: false, trigger: null };
  }

  // A workflow that cannot run must not be switched on: the same validation the
  // engine uses, run before anything is claimed.
  validateWorkflow(wf, nodeTypes);

  const trigger = findTriggerNode(wf);
  const kind = TRIGGERS[trigger?.type];
  if (!kind) {
    throw Object.assign(
      new Error('Only Webhook and Schedule workflows can be activated. A Manual Trigger runs from the Run button.'),
      { status: 400 });
  }

  const summary = await withTransaction(async (client) => {
    await client.query('DELETE FROM webhooks WHERE workflow_id = $1', [workflowId]);
    await client.query('DELETE FROM schedules WHERE workflow_id = $1', [workflowId]);

    if (kind === 'webhook') {
      const path = String(trigger.parameters?.path ?? '').trim();
      const method = String(trigger.parameters?.method ?? 'POST').toUpperCase();
      const responseMode = trigger.parameters?.responseMode ?? 'lastNode';
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(path)) {
        throw Object.assign(new Error('The Webhook node needs a path of lower-case letters, numbers and hyphens'),
                            { status: 400 });
      }
      try {
        // one live address and one test address, so experiments never fire real emails
        for (const isTest of [false, true]) {
          await client.query(
            'INSERT INTO webhooks (path, method, workflow_id, node_name, is_test, response_mode) '
            + 'VALUES ($1,$2,$3,$4,$5,$6)',
            [path, method, workflowId, trigger.name, isTest, responseMode]);
        }
      } catch (e) {
        if (e.code === '23505') {
          throw Object.assign(new Error(`Another workflow already listens on ${method} /webhook/${path}`),
                              { status: 409 });
        }
        throw e;
      }
      await client.query('UPDATE workflows SET active = true WHERE id = $1', [workflowId]);
      return { active: true, trigger: { kind, path, method, responseMode } };
    }

    const cron = String(trigger.parameters?.cron ?? '0 * * * *');
    const timezone = String(trigger.parameters?.timezone ?? 'Australia/Sydney');
    let next;
    try {
      next = validateSchedule({ cron, timezone });
    } catch (e) {
      throw Object.assign(e, { status: 400 });
    }
    await client.query(
      'INSERT INTO schedules (workflow_id, node_name, cron, timezone) VALUES ($1,$2,$3,$4) '
      + 'ON CONFLICT (workflow_id) DO UPDATE SET cron = $3, timezone = $4',
      [workflowId, trigger.name, cron, timezone]);
    await client.query('UPDATE workflows SET active = true WHERE id = $1', [workflowId]);
    return { active: true, trigger: { kind, cron, timezone, next: next?.toISOString() ?? null } };
  });

  // the timer is registered only once the transaction committed
  if (summary.trigger?.kind === 'schedule') {
    activate(wf, { cron: summary.trigger.cron, timezone: summary.trigger.timezone });
  }
  return summary;
}
