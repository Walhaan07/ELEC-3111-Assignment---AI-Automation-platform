import { useState } from 'react';
import type { Item, LogLine } from '../types';

/**
 * The bottom drawer: what the last run produced, and the engine's receipt.
 *
 * The log is quoted verbatim in the report - one line per node, in the order
 * the engine chose them, with a millisecond count.
 */
export default function OutputPanel({
  selectedName,
  output,
  log,
  height,
  onHeight,
}: {
  selectedName: string | null;
  output: Item[][] | null;
  log: LogLine[];
  height: number;
  onHeight: (h: number) => void;
}) {
  const [tab, setTab] = useState<'output' | 'log'>('output');
  const items = (output ?? []).flat();

  return (
    <section className="drawer" style={{ height }} data-testid="output-panel">
      <div
        style={{ height: 5, cursor: 'ns-resize', flex: 'none', marginTop: -3 }}
        onPointerDown={(e) => {
          const startY = e.clientY;
          const startH = height;
          const move = (ev: PointerEvent) =>
            onHeight(Math.min(560, Math.max(120, startH - (ev.clientY - startY))));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />

      <div className="drawer-head">
        <button className={`tab${tab === 'output' ? ' on' : ''}`} onClick={() => setTab('output')}>
          Output{selectedName ? ` · ${selectedName}` : ''}
        </button>
        <button className={`tab${tab === 'log' ? ' on' : ''}`} onClick={() => setTab('log')}>
          Log{log.length ? ` (${log.length})` : ''}
        </button>
        <div className="spacer" />
        {tab === 'output' && items.length > 0 && (
          <span className="pill">{items.length} item{items.length === 1 ? '' : 's'}</span>
        )}
        {totalMs(log) !== null && <span className="pill">{totalMs(log)} ms total</span>}
      </div>

      <div className="drawer-body">
        {tab === 'output' ? (
          items.length === 0 ? (
            <div className="empty">
              {selectedName
                ? 'This node has not produced anything yet. Press Run.'
                : 'Select a node to see what it produced.'}
            </div>
          ) : (
            <pre className="json" data-testid={`output-${selectedName}`}>
              {highlight(JSON.stringify(items.map((i) => i.json), null, 2))}
            </pre>
          )
        ) : log.length === 0 ? (
          <div className="empty">Nothing has run yet.</div>
        ) : (
          <div data-testid="log-lines">
            {log.map((line, i) => (
              <div className="log-line" key={i}>
                <span className={`log-level ${line.level}`}>{line.level}</span>
                <span className="log-node">{line.node}</span>
                <span className="log-msg">
                  {line.msg ?? (line.items !== undefined ? `${line.items} item(s)` : '')}
                </span>
                <span className="log-ms">{line.ms !== undefined ? `${line.ms} ms` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function totalMs(log: LogLine[]): number | null {
  const done = log.filter((l) => typeof l.ms === 'number');
  if (done.length === 0) return null;
  return done.reduce((n, l) => n + (l.ms ?? 0), 0);
}

/** Just enough colouring to make a JSON payload readable at a glance. */
function highlight(json: string) {
  const parts = json.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (/^"/.test(part)) {
      return <span key={i} className={part.trim().endsWith(':') ? 'json-key' : 'json-str'}>{part}</span>;
    }
    if (/^(true|false|null)$/.test(part)) return <span key={i} className="json-bool">{part}</span>;
    if (/^-?\d/.test(part)) return <span key={i} className="json-num">{part}</span>;
    return <span key={i}>{part}</span>;
  });
}
