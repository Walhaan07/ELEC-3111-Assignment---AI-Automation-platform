import { useEffect, useState } from 'react';
import { api } from '../api';
import { UI, UIIcon } from '../icons';

type Row = {
  id: string; name: string; active: boolean; version: number;
  updated_at: string; node_count: number;
};

export default function WorkflowList({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = () => api<{ data: Row[] }>('/rest/workflows')
    .then((r) => setRows(r.data))
    .catch((e) => setError(e.message))
    .finally(() => setBusy(false));

  useEffect(() => { void load(); }, []);

  const create = async () => {
    try {
      const wf = await api<{ id: string }>('/rest/workflows', {
        method: 'POST',
        body: JSON.stringify({ name: 'My workflow', nodes: [], connections: {} }),
      });
      onNavigate(`/workflow/${wf.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (row: Row) => {
    if (!confirm(`Delete "${row.name}"? Its past runs go too.`)) return;
    await api(`/rest/workflows/${row.id}`, { method: 'DELETE' });
    void load();
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Workflows</h1>
          <p className="sub">Every automation in this installation.</p>
        </div>
        <button className="btn primary" onClick={() => void create()} data-testid="new-workflow">
          <UIIcon d={UI.plus} size={14} /> New workflow
        </button>
      </div>

      {error && <div className="card" style={{ padding: 16, color: '#f87171' }}>{error}</div>}

      <div className="card">
        <div className="card-head">
          {busy ? 'Loading…' : `${rows.length} workflow${rows.length === 1 ? '' : 's'}`}
        </div>
        {rows.length === 0 && !busy ? (
          <div className="empty">
            <div className="empty-mark">✧</div>
            Nothing here yet. Create your first workflow.
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Status</th><th>Nodes</th><th>Version</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid={`workflow-row-${row.id}`}>
                  <td>
                    <a
                      className="link" href={`#/workflow/${row.id}`}
                      onClick={(e) => { e.preventDefault(); onNavigate(`/workflow/${row.id}`); }}
                    >
                      {row.name}
                    </a>
                  </td>
                  <td>
                    <span className={`pill ${row.active ? 'ok' : ''}`}>
                      <span className="dot" />{row.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="mono">{row.node_count}</td>
                  <td className="mono">v{row.version}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{when(row.updated_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost sm danger" onClick={() => void remove(row)} title="Delete">
                      <UIIcon d={UI.trash} size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function when(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return date.toLocaleDateString();
}
