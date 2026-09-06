import { useEffect, useRef, useState, useCallback } from 'react';
import type { LiveEvent, NodeRunState, Item, LogLine } from './types';

export type RunState = {
  nodes: Record<string, { state: NodeRunState; items?: number; ms?: number; error?: string }>;
  output: Record<string, Item[][]>;
  log: LogLine[];
  running: boolean;
  executionId: string | null;
};

const EMPTY: RunState = { nodes: {}, output: {}, log: [], running: false, executionId: null };

/**
 * Live progress from the server, over Server-Sent Events.
 *
 * The engine reports every node it starts and finishes; this hook turns that
 * stream into the state the canvas colours its boxes from, so a node lights up
 * while it is working rather than after everything has finished.
 */
export function useLiveRun(workflowId: string | null) {
  const [run, setRun] = useState<RunState>(EMPTY);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!workflowId) return;

    const es = new EventSource(`/rest/workflows/${workflowId}/events`);
    source.current = es;

    es.onmessage = (message) => {
      let event: LiveEvent;
      try { event = JSON.parse(message.data); } catch { return; }

      setRun((prev) => {
        switch (event.type) {
          case 'execution-started':
            return { nodes: {}, output: {}, log: [], running: true, executionId: event.executionId };

          case 'node-started':
            return { ...prev, running: true, nodes: { ...prev.nodes, [event.node]: { state: 'running' } } };

          case 'node-finished':
            return {
              ...prev,
              nodes: { ...prev.nodes, [event.node]: { state: 'success', items: event.items, ms: event.ms } },
              output: { ...prev.output, [event.node]: event.preview },
              log: [...prev.log, { node: event.node, level: 'done', ms: event.ms, items: event.items }],
            };

          case 'node-error':
            return {
              ...prev,
              nodes: { ...prev.nodes, [event.node]: { state: 'error', ms: event.ms, error: event.message } },
              log: [...prev.log, { node: event.node, level: 'error', ms: event.ms, msg: event.message }],
            };

          case 'node-skipped':
            return { ...prev, nodes: { ...prev.nodes, [event.node]: { state: 'skipped' } } };

          case 'node-log':
            return { ...prev, log: [...prev.log, { node: event.node, level: 'info', msg: event.msg }] };

          case 'execution-finished':
            return { ...prev, running: false };

          default:
            return prev;
        }
      });
    };

    // The browser reconnects on its own; there is nothing useful to do here but
    // avoid a console full of red when the API restarts in development.
    es.onerror = () => {};

    return () => { es.close(); source.current = null; };
  }, [workflowId]);

  const reset = useCallback(() => setRun(EMPTY), []);

  /** A finished run fetched from the server fills in the same shape. */
  const applyResult = useCallback((data: Record<string, Item[][]> | undefined, log: LogLine[] | undefined) => {
    setRun((prev) => ({
      ...prev,
      running: false,
      output: data ?? prev.output,
      log: log ?? prev.log,
    }));
  }, []);

  return { run, reset, applyResult };
}
