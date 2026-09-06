import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import type { NodeDescription } from '../types';

/**
 * The palette. Drag an entry onto the canvas, or click it to drop one in the
 * middle. It is built entirely from GET /rest/node-types, so a node added in
 * packages/nodes appears here after a refresh with no UI work.
 */

const GROUP_ORDER = ['trigger', 'flow', 'transform', 'action'] as const;
const GROUP_TITLE: Record<string, string> = {
  trigger: 'Triggers - how a workflow starts',
  flow: 'Flow - routing and joining',
  transform: 'Transform - reshape the items',
  action: 'Actions - do something outside',
};

export default function NodePalette({
  descriptions,
  onAdd,
}: {
  descriptions: NodeDescription[];
  onAdd: (description: NodeDescription) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = descriptions.filter((d) =>
      !needle
      || d.displayName.toLowerCase().includes(needle)
      || (d.description ?? '').toLowerCase().includes(needle)
      || d.name.toLowerCase().includes(needle));

    return GROUP_ORDER
      .map((group) => ({ group, items: matching.filter((d) => d.group === group) }))
      .filter((g) => g.items.length > 0);
  }, [descriptions, query]);

  return (
    <aside className="side" data-testid="palette">
      <div className="side-head">
        <input
          className="search"
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="palette-search"
          aria-label="Search nodes"
        />
      </div>

      <div className="side-body">
        {groups.length === 0 && (
          <div className="empty">
            <div className="empty-mark">∅</div>
            Nothing matches “{query}”.
          </div>
        )}

        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="group-label">{GROUP_TITLE[group] ?? group}</div>
            {items.map((d) => (
              <button
                key={d.name}
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/node-type', d.name);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onAdd(d)}
                data-testid={`palette-${d.name}`}
                title={d.description}
              >
                <span className="palette-icon" style={{ background: d.colour ?? '#64748b' }}>
                  <Icon name={d.icon} size={15} />
                </span>
                <span className="palette-text">
                  <span className="palette-name">{d.displayName}</span>
                  <span className="palette-desc">{d.description}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="hint-bar">
        Drag a node onto the canvas, or click to drop one in.<br />
        <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Del</kbd> remove · drag a dot to connect.
      </div>
    </aside>
  );
}
