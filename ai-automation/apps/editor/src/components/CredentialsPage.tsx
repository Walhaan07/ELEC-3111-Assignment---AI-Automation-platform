import { useEffect, useState } from 'react';
import { api } from '../api';
import { UI, UIIcon } from '../icons';
import type { Credential } from '../types';

/**
 * Credentials.
 *
 * Nothing on this page ever shows a token: the server stores an encrypted
 * envelope and hands out only "connected" and "expires at".
 */
const TYPES = [
  { value: 'googleSheets', label: 'Google Sheets' },
  { value: 'googleDrive', label: 'Google Drive' },
  { value: 'googleDocs', label: 'Google Docs' },
  { value: 'gmail', label: 'Gmail' },
];

export default function CredentialsPage() {
  const [rows, setRows] = useState<Credential[]>([]);
  const [googleReady, setGoogleReady] = useState(true);
  const [name, setName] = useState('');
  const [type, setType] = useState('googleSheets');
  const [error, setError] = useState('');

  const load = () => api<{ data: Credential[]; googleReady: boolean }>('/rest/credentials')
    .then((r) => { setRows(r.data); setGoogleReady(r.googleReady); })
    .catch((e) => setError(e.message));

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api('/rest/credentials', { method: 'POST', body: JSON.stringify({ name, type }) });
      setName('');
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (row: Credential) => {
    if (!confirm(`Delete "${row.name}"?`)) return;
    await api(`/rest/credentials/${row.id}`, { method: 'DELETE' });
    void load();
  };

  return (
    <div className="page">
      <h1>Credentials</h1>
      <p className="sub">
        Connect a Google account once; the nodes use it afterwards. Tokens are encrypted
        with AES-256-GCM and never leave the server.
      </p>

      {!googleReady && (
        <div className="card" style={{ padding: 16, marginBottom: 16, color: '#fbbf24' }}>
          GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in <span className="mono">.env</span>,
          so Connect cannot work yet. Everything else on this page still does.
        </div>
      )}
      {error && <div className="card" style={{ padding: 16, marginBottom: 16, color: '#f87171' }}>{error}</div>}

      <div className="card">
        <div className="card-head">Add a credential</div>
        <div style={{ padding: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input" style={{ flex: '2 1 200px' }}
            placeholder="Sheets - group account"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="credential-name"
          />
          <select className="select" style={{ flex: '1 1 160px' }} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button className="btn primary" onClick={() => void create()} data-testid="add-credential">
            <UIIcon d={UI.plus} size={14} /> Add
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">{rows.length} credential{rows.length === 1 ? '' : 's'}</div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">🔑</div>
            No credentials yet. Add one, then press Connect.
          </div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>State</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="mono">{row.type}</td>
                  <td>
                    <span className={`pill ${row.connected ? 'ok' : 'warn'}`}>
                      <span className="dot" />
                      {row.connected ? `Connected${expiry(row.expires_at)}` : 'Not connected'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <a
                      className="btn sm"
                      href={`/rest/oauth2-credential/auth?type=${row.type}&credentialId=${row.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <UIIcon d={UI.key} size={13} /> {row.connected ? 'Reconnect' : 'Connect'}
                    </a>
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

      <div className="card">
        <div className="card-head">Before the demo</div>
        <div style={{ padding: 16, color: 'var(--text-dim)', lineHeight: 1.7, fontSize: 13 }}>
          While the Google app is in Testing mode a refresh token lasts seven days. Press
          Connect on each credential on the morning of the demonstration - it takes forty
          seconds, and it has ended more student demos than any bug.
        </div>
      </div>
    </div>
  );
}

function expiry(iso: string | null): string {
  if (!iso) return '';
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return ' · refreshes on next use';
  return ` · ${minutes} min`;
}
