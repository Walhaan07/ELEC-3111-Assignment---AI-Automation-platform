import { useEffect, useState } from 'react';
import { api } from '../api';
import { when } from './WorkflowList';
import type { ExecutionSummary } from '../types';

/**
 * Every past run, newest first.
 *
 * The failed rows are the interesting ones: each carries the engine's message
 * with the failing node's name in it, which is what makes a failure debuggable
 * three days later.
 */
export default function ExecutionsPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [rows, setRows] = useState<ExecutionSummary[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    const load = () => api<{ data: ExecutionSummary[] }>('/rest/executions?limit=50')
      .then((r) => { if (live) { setRows(r.data); setBusy(false); } })
      .catch(() => setBusy(false));

    void load();
    const timer = setInterval(load, 4000);       // a running row should not need a refresh
    return () => { live = false; clearInterval(timer); };
  }, []);

  return (
    <div className="page">
      <h1>Executions</h1>
      <p className="sub">Every run, with the mode that started it and how long it took.</p>

      <div className="card">
        <div className="card-head">{busy ? 'Loading…' : `${rows.length} run${rows.length === 1 ? '' : 's'}`}</div>
        {rows.length === 0 && !busy ? (
          <div className="empty">Nothing has run yet.</div>
        ) : (
          <table data-testid="executions-table">
            <thead>
              <tr><th>Status</th><th>Workflow</th><th>Mode</th><th>Started</th><th>Took</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={`pill ${statusKind(row.status)}`}>
                      <span className={`dot${row.status === 'running' ? ' pulse' : ''}`} />
                      {row.status}
                    </span>
                    {row.error?.message && (
                      <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 5, maxWidth: 420 }}>
                        {row.error.node ? `${row.error.node}: ` : ''}{row.error.message}
                      </div>
                    )}
                  </td>
                  <td>
                    <a
                      className="link" href={`#/workflow/${row.workflow_id}`}
                      onClick={(e) => { e.preventDefault(); onNavigate(`/workflow/${row.workflow_id}`); }}
                    >
                      {row.workflow_name}
                    </a>
                  </td>
                  <td className="mono">{row.mode}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{when(row.started_at)}</td>
                  <td className="mono">{row.ms === null ? '…' : `${row.ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const statusKind = (status: string) =>
  status === 'success' ? 'ok' : status === 'error' ? 'err' : status === 'running' ? 'busy' : '';
