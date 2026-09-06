import { Cron } from 'croner';
import { db } from './db.js';
import { runById } from './runner.js';

/**
 * The schedule registry - with the three guards a cron always needs.
 *
 * A workflow's timers exist only while it is active. Activating re-reads the
 * Schedule node's settings, deactivating stops the timer, and restoreAll()
 * rebuilds every timer on boot so schedules do not stop silently after a deploy.
 */

const jobs = new Map();          // workflowId -> Cron

export function validateSchedule({ cron, timezone }) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (e) {
    throw new Error(`"${timezone}" is not a time zone`, { cause: e });
  }
  let probe;
  try {
    probe = new Cron(cron, { timezone, paused: true });
  } catch (e) {
    throw new Error(`"${cron}" is not a valid cron expression (${e.message})`, { cause: e });
  }
  const next = probe.nextRun();
  probe.stop();
  if (!next) throw new Error(`"${cron}" will never run`);
  return next;
}

export function activate(workflow, schedule) {
  deactivate(workflow.id);
  validateSchedule(schedule);

  const job = new Cron(
    schedule.cron,
    {
      timezone: schedule.timezone,
      protect: true,   // 1 - if the last run is still going, SKIP this tick, never pile up
      catch: (err) => console.error(`[schedule ${workflow.name}]`, err.message),  // 2 - never crash
    },
    () => runById(workflow.id, [{
      json: {
        timestamp: new Date().toISOString(),
        scheduledFor: job.currentRun()?.toISOString() ?? null,
      },
    }], 'schedule'),
  );

  jobs.set(workflow.id, job);
  console.log(`[schedule] ${workflow.name} -> next ${job.nextRun()?.toISOString()}`);
  return job.nextRun();
}

export function deactivate(workflowId) {   // 3 - always stop the old timer first
  jobs.get(workflowId)?.stop();
  jobs.delete(workflowId);
}

/** Rebuild every timer on boot - otherwise schedules stop silently after each deploy. */
export async function restoreAll() {
  const { rows } = await db.query(
    'SELECT w.*, s.cron, s.timezone FROM workflows w JOIN schedules s ON s.workflow_id = w.id '
    + 'WHERE w.active = true');
  let restored = 0;
  for (const row of rows) {
    try {
      activate(row, row);
      restored += 1;
    } catch (e) {
      console.error(`[schedule] ${row.name} is broken: ${e.message}`);
    }
  }
  console.log(`restored ${restored} schedule(s)`);
  return restored;
}

export function stopAll() {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}

export const listSchedules = () => [...jobs.entries()].map(([workflowId, job]) => ({
  workflowId,
  next: job.nextRun()?.toISOString() ?? null,
  running: job.isBusy(),
}));
