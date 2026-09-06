import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '../icons';
import type { NodeDescription, WorkflowNode as WfNode, NodeRunState } from '../types';

/**
 * One box on the canvas.
 *
 * Everything it draws comes from the node's own description: the icon, the
 * colour, and one output handle per branch. A node added to
 * packages/nodes/index.js therefore appears here correctly with no edit to
 * this file - which is the whole point of the schema-driven design.
 */

export type WorkflowNodeData = {
  node: WfNode;
  description?: NodeDescription;
  state?: NodeRunState;
  items?: number;
  ms?: number;
  error?: string;
};

function WorkflowNodeView({ data, selected }: NodeProps) {
  const { node, description, state = 'idle', items, ms, error } = data as WorkflowNodeData;
  const outputs = description?.outputs?.length ? description.outputs : ['main'];
  const hasInput = (description?.inputs?.length ?? 1) > 0;
  const colour = description?.colour ?? '#64748b';

  return (
    <div
      className={[
        'node',
        `state-${state}`,
        selected ? 'selected' : '',
        node.disabled ? 'disabled' : '',
      ].join(' ')}
      data-testid={`node-${node.name}`}
      data-state={state}
      title={error ?? description?.description ?? ''}
    >
      {node.disabled && <span className="node-flag">disabled</span>}

      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          data-testid={`target-${node.name}`}
          style={{ top: 28 }}
        />
      )}

      <div className="node-head">
        <div className="node-icon" style={{ background: colour }}>
          <Icon name={description?.icon} size={17} />
        </div>
        <div className="node-title">
          <div className="node-name">{node.name}</div>
          <div className="node-type">{description?.displayName ?? node.type}</div>
        </div>
      </div>

      <div className="node-foot">
        {state === 'running' && <span className="node-badge run">running…</span>}
        {state === 'success' && (
          <>
            <span className="node-badge ok">{items ?? 0} item{items === 1 ? '' : 's'}</span>
            <span className="mono">{ms ?? 0} ms</span>
          </>
        )}
        {state === 'error' && <span className="node-badge err">failed</span>}
        {state === 'skipped' && <span className="mono">skipped</span>}
        {state === 'idle' && <span className="mono" style={{ opacity: .55 }}>{subtitle(node)}</span>}
      </div>

      {outputs.map((label, index) => {
        const top = 28 + index * 22;
        return (
          <div key={label + index}>
            <Handle
              type="source"
              position={Position.Right}
              id={String(index)}
              data-testid={`handle-${node.name}-${index}`}
              style={{ top }}
            />
            {outputs.length > 1 && (
              <span className="handle-label" style={{ top }}>{label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A one-line summary of the most useful setting, the way n8n shows one. */
function subtitle(node: WfNode): string {
  const p = node.parameters ?? {};
  const first = (...keys: string[]) => {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  };
  const value = first('url', 'path', 'cron', 'to', 'documentId', 'fileName', 'model', 'mode', 'operation');
  if (!value) return '';
  return value.length > 26 ? `${value.slice(0, 25)}…` : value;
}

export default memo(WorkflowNodeView);
