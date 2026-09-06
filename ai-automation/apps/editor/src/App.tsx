import { useEffect, useState } from 'react';
import Editor from './Editor';
import WorkflowList from './components/WorkflowList';
import ExecutionsPage from './components/ExecutionsPage';
import CredentialsPage from './components/CredentialsPage';
import { UI, UIIcon } from './icons';

/**
 * Four screens, addressed by the hash so a link can be pasted into the group
 * chat and reload straight back to the same workflow. No router dependency.
 */
export default function App() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/');

  useEffect(() => {
    const onHash = () => setPath(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (to: string) => { window.location.hash = to; };

  const workflowId = path.match(/^\/workflow\/([0-9a-f-]{36})$/i)?.[1];
  if (workflowId) return <Editor id={workflowId} onNavigate={navigate} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▲</span>
          <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>AI Automation</a>
        </div>
        <span className="topbar-divider" />
        <nav style={{ display: 'flex', gap: 4 }}>
          <NavLink to="/" now={path} go={navigate} icon={UI.list}>Workflows</NavLink>
          <NavLink to="/executions" now={path} go={navigate} icon={UI.run}>Executions</NavLink>
          <NavLink to="/credentials" now={path} go={navigate} icon={UI.key}>Credentials</NavLink>
        </nav>
        <div className="spacer" />
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {path === '/executions' ? <ExecutionsPage onNavigate={navigate} />
          : path === '/credentials' ? <CredentialsPage />
            : <WorkflowList onNavigate={navigate} />}
      </div>
    </div>
  );
}

function NavLink({
  to, now, go, icon, children,
}: {
  to: string; now: string; go: (to: string) => void; icon: string; children: React.ReactNode;
}) {
  const on = now === to;
  return (
    <button className={`btn sm${on ? ' primary' : ' ghost'}`} onClick={() => go(to)}>
      <UIIcon d={icon} size={13} /> {children}
    </button>
  );
}
