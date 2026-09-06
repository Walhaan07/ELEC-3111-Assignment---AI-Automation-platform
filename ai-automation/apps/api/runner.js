import { db } from './db.js';
import { runWorkflow, WorkflowError } from '@ai-automation/engine';
import { toErrorPayload } from '@ai-automation/engine/errors.js';
import { nodeTypes } from '@ai-automation/nodes';
import { publish } from './events.js';
import { loadRunCredentials } from './credentials.js';

/**
 * One runner, so every trigger starts a workflow the same way.
 *
 * The manual Run button, the webhook and the scheduler all funnel through
 * runById(), which means the concurrency limit and the execution row exist
 * once instead of three times.
 */

const MAX_CONCURRENT = 5;
let inFlight = 0;
const queue = [];

// A tiny queue: five workflows at once, the rest wait their turn. Without it,
// one popular webhook opens 200 database clients and the server stops answering.
function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const start = async () => {
      inFlight++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        inFlight--;
        queue.shift()?.();
      }
    };
    if (inFlight < MAX_CONCURRENT) start(); else queue.push(start);
  });
}

export const runnerStats = () => ({ inFlight, queued: queue.length, maxConcurrent: MAX_CONCURRENT });

export async function runById(workflowId, triggerItems, mode = 'manual') {
  return withSlot(async () => {
    const { rows: [wf] } = await db.query('SELECT * FROM workflows WHERE id = $1', [workflowId]);
    if (!wf) throw new WorkflowError('That workflow no longer exists', { code: 'NOT_FOUND' });

    const { rows: [run] } = await db.query(
      "INSERT INTO executions (workflow_id, status, mode) VALUES ($1,'running',$2) RETURNING id",
      [workflowId, mode]);

    const startedAt = Date.now();
    publish(workflowId, { type: 'execution-started', executionId: run.id, mode });

    try {
      const credentials = await loadRunCredentials(wf);
      const { results, log } = await runWorkflow(wf, nodeTypes, {
        triggerItems,
        credentials,
        onEvent: (event) => publish(workflowId, { ...event, executionId: run.id }),
      });

      await db.query(
        "UPDATE executions SET status='success', data=$1, log=$2, finished_at=now() WHERE id=$3",
        [JSON.stringify(results), JSON.stringify(log), run.id]);

      publish(workflowId, {
        type: 'execution-finished', executionId: run.id, status: 'success', ms: Date.now() - startedAt,
      });
      return { executionId: run.id, status: 'success', results, log };
    } catch (err) {
      const payload = toErrorPayload(err);
      await db.query(
        "UPDATE executions SET status='error', error=$1, finished_at=now() WHERE id=$2",
        [JSON.stringify(payload), run.id]);

      publish(workflowId, {
        type: 'execution-finished', executionId: run.id, status: 'error',
        ms: Date.now() - startedAt, error: payload,
      });
      throw Object.assign(err, { executionId: run.id, payload });
    }
  });
}

/** Anything still 'running' when the server died is a lie - clean it up on boot. */
export async function reapStuckExecutions() {
  const { rowCount } = await db.query(
    "UPDATE executions SET status='cancelled', finished_at=now() WHERE status='running'");
  if (rowCount) console.log(`marked ${rowCount} interrupted execution(s) as cancelled`);
  return rowCount;
}
