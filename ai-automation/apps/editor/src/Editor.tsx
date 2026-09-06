import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  type Connection, type Edge, type Node as RfNode, type NodeChange, type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api, ApiError } from './api';
import { toReactFlow, fromReactFlow, uniqueName } from './convert';
import WorkflowNodeView from './components/WorkflowNode';
import WorkflowEdge from './components/WorkflowEdge';
import NodePalette from './components/NodePalette';
import ParameterPanel from './components/ParameterPanel';
import OutputPanel from './components/OutputPanel';
import { useLiveRun } from './useLiveRun';
import { UI, UIIcon } from './icons';
import type { NodeDescription, Workflow, WorkflowNode, RunResult, Item } from './types';

const nodeTypes = { workflowNode: WorkflowNodeView };
const edgeTypes = { workflowEdge: WorkflowEdge };

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function Editor({ id, onNavigate }: { id: string; onNavigate: (to: string) => void }) {
  return (
    <ReactFlowProvider>
      <EditorInner id={id} onNavigate={onNavigate} />
    </ReactFlowProvider>
  );
}

function EditorInner({ id, onNavigate }: { id: string; onNavigate: (to: string) => void }) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<RfNode>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [descriptions, setDescriptions] = useState<NodeDescription[]>([]);
  const [name, setName] = useState('');
  const [active, setActive] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [panelValid, setPanelValid] = useState(true);
  const [drawerHeight, setDrawerHeight] = useState(190);
  const [loading, setLoading] = useState(true);

  const version = useRef(1);
  const dirty = useRef(false);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const { run, reset: resetRun, applyResult } = useLiveRun(id);

  const byName = useMemo(
    () => Object.fromEntries(descriptions.map((d) => [d.name, d])),
    [descriptions],
  );

  const flash = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // --- load ---------------------------------------------------------------
  useEffect(() => {
    const stop = new AbortController();

    Promise.all([
      api<NodeDescription[]>('/rest/node-types', { signal: stop.signal }),
      api<Workflow>(`/rest/workflows/${id}`, { signal: stop.signal }),
    ])
      .then(([types, wf]) => {
        setDescriptions(types);
        setName(wf.name);
        setActive(Boolean(wf.active));
        setWebhookUrl(wf.webhookUrl ?? null);
        version.current = wf.version ?? 1;
        const flow = toReactFlow(wf);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setLoading(false);
        setStatus('error');
        setMessage(e.message);
      });

    // React 18+ mounts twice in development - aborting here is what stops the
    // second load racing the first and showing stale data.
    return () => stop.abort();
  }, [id, setNodes, setEdges]);

  // --- save ---------------------------------------------------------------
  const save = useCallback(async () => {
    if (loading) return;
    setStatus('saving');
    try {
      const saved = await api<Workflow>(`/rest/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...fromReactFlow(nodes, edges), name, version: version.current }),
      });
      version.current = saved.version ?? version.current + 1;
      dirty.current = false;
      setStatus('saved');
      setMessage('');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof ApiError && e.status === 409
        ? 'Someone else saved this workflow. Reload to get their changes.'
        : (e as Error).message);
    }
  }, [id, nodes, edges, name, loading]);

  // autosave, 1.2 s after you stop moving things
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, 1200);
    return () => clearTimeout(timer);
  }, [nodes, edges, name, save]);

  // Ctrl/Cmd-S, Delete, and a browser-close warning
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
      // Escape closes the settings panel. Without it the panel covers a third
      // of the canvas and there is no way back except clicking empty space.
      if (e.key === 'Escape') setSelectedId(null);
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [save]);

  // Those eleven characters - dirty.current = true - are what turn a Save
  // button into an editor nobody can lose work in.
  const onNodesChange = useCallback((changes: NodeChange<RfNode>[]) => {
    if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) dirty.current = true;
    onNodesChangeBase(changes);
  }, [onNodesChangeBase]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    if (changes.some((c) => c.type !== 'select')) dirty.current = true;
    onEdgesChangeBase(changes);
  }, [onEdgesChangeBase]);

  const onConnect = useCallback((connection: Connection) => {
    dirty.current = true;
    setEdges((current) => addEdge({
      ...connection,
      type: 'workflowEdge',
      id: `${connection.source}:${connection.sourceHandle ?? '0'}->${connection.target}`,
    }, current));
  }, [setEdges]);

  // --- adding nodes -------------------------------------------------------
  const addNode = useCallback((description: NodeDescription, position?: { x: number; y: number }) => {
    // A node added by clicking is placed for you, so the canvas moves to show
    // it. A node you dragged to a spot stays exactly where you dropped it.
    const bringIntoView = position === undefined;

    setNodes((current) => {
      const taken = current.map((n) => n.id);
      const nodeName = uniqueName(description.displayName, taken);
      const parameters: Record<string, unknown> = {};
      for (const p of description.properties) {
        if (p.default !== undefined) parameters[p.name] = p.default;
      }
      const node: WorkflowNode = { name: nodeName, type: description.name, parameters };
      dirty.current = true;
      setSelectedId(nodeName);

      // Place it clear of everything else: one step to the right of the
      // right-most node, on the same line. Two clicks in a row must never
      // drop one box on top of another.
      const rightMost = current.reduce<{ x: number; y: number } | null>(
        (best, n) => (best === null || n.position.x > best.x ? n.position : best), null);
      const dropped = position
        ?? (rightMost ? { x: rightMost.x + 280, y: rightMost.y } : { x: 120, y: 200 });

      return [
        ...current.map((n) => ({ ...n, selected: false })),
        {
          id: nodeName,
          type: 'workflowNode',
          position: dropped,
          data: { node },
          selected: true,
        } as RfNode,
      ];
    });

    if (bringIntoView) {
      // after React Flow has measured the new box, not before
      requestAnimationFrame(() => { void fitView({ padding: 0.35, duration: 200, maxZoom: 1 }); });
    }
  }, [setNodes, fitView]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/node-type');
    const description = byName[type];
    if (!description) return;
    addNode(description, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [byName, addNode, screenToFlowPosition]);

  // --- the selected node --------------------------------------------------
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedNode = selected ? (selected.data as { node: WorkflowNode }).node : null;

  const patchSelected = useCallback((patch: Partial<WorkflowNode>) => {
    if (!selectedId) return;
    dirty.current = true;
    setNodes((current) => current.map((n) => (n.id === selectedId
      ? { ...n, data: { ...n.data, node: { ...(n.data as any).node, ...patch } } }
      : n)));
  }, [selectedId, setNodes]);

  const renameSelected = useCallback((next: string) => {
    if (!selectedId) return;
    const clean = next.trim();
    dirty.current = true;

    // A rename has to move the node id AND every edge that pointed at it, or the
    // workflow silently loses its connections.
    setNodes((current) => current.map((n) => (n.id === selectedId
      ? { ...n, id: clean || n.id, data: { ...n.data, node: { ...(n.data as any).node, name: clean || n.id } } }
      : n)));
    setEdges((current) => current.map((e) => ({
      ...e,
      source: e.source === selectedId ? clean : e.source,
      target: e.target === selectedId ? clean : e.target,
    })));
    setSelectedId(clean || selectedId);
  }, [selectedId, setNodes, setEdges]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    dirty.current = true;
    setNodes((current) => current.filter((n) => n.id !== selectedId));
    setEdges((current) => current.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }, [selectedId, setNodes, setEdges]);

  // --- run ----------------------------------------------------------------
  const [running, setRunning] = useState(false);

  const runWorkflow = useCallback(async () => {
    if (dirty.current) await save();       // never run a version the server has not got
    resetRun();
    setRunning(true);
    setMessage('Running…');
    try {
      const result = await api<RunResult>(`/rest/workflows/${id}/run`, { method: 'POST' });
      applyResult(result.data, result.log);
      setStatus('saved');
      const ms = (result.log ?? []).reduce((n, l) => n + (l.ms ?? 0), 0);
      setMessage(`Finished in ${ms} ms`);
      flash('Workflow finished', 'ok');
    } catch (e) {
      const body: any = e instanceof ApiError ? e.body : null;
      const failed = body?.error?.node ?? null;
      setStatus('error');
      setMessage(body?.error?.message ?? (e as Error).message);
      flash(body?.error?.message ?? (e as Error).message, 'err');
      if (failed) setSelectedId(failed);
    } finally {
      setRunning(false);
    }
  }, [id, save, resetRun, applyResult, flash]);

  const toggleActive = useCallback(async () => {
    try {
      if (dirty.current) await save();
      const next = !active;
      const summary = await api<{ active: boolean; trigger: any }>(
        `/rest/workflows/${id}/activate`, { method: 'POST', body: JSON.stringify({ active: next }) });
      setActive(summary.active);
      const wf = await api<Workflow>(`/rest/workflows/${id}`);
      setWebhookUrl(wf.webhookUrl ?? null);
      flash(summary.active ? 'Workflow is live' : 'Workflow deactivated', 'ok');
    } catch (e) {
      flash((e as Error).message, 'err');
    }
  }, [id, active, save, flash]);

  // --- what the canvas draws ---------------------------------------------
  const viewNodes = useMemo(() => nodes.map((n) => {
    const wfNode = (n.data as { node: WorkflowNode }).node;
    const live = run.nodes[n.id];
    return {
      ...n,
      data: {
        node: wfNode,
        description: byName[wfNode.type],
        state: live?.state ?? 'idle',
        items: live?.items,
        ms: live?.ms,
        error: live?.error,
      },
    };
  }), [nodes, byName, run.nodes]);

  const viewEdges = useMemo(() => edges.map((e) => {
    const sourceState = run.nodes[e.source]?.state;
    const running = sourceState === 'running';
    const done = sourceState === 'success';
    return {
      ...e,
      type: 'workflowEdge',
      animated: running,
      className: running ? 'running' : done ? 'done' : '',
    };
  }), [edges, run.nodes]);

  // the last item any node produced - what the expression preview is built from
  const sampleItem: Item | null = useMemo(() => {
    if (selectedId) {
      const upstream = edges.find((e) => e.target === selectedId)?.source;
      const fromUpstream = upstream ? run.output[upstream]?.flat()?.[0] : null;
      if (fromUpstream) return fromUpstream;
    }
    const any = Object.values(run.output).flat(2);
    return any.length ? (any[0] as Item) : null;
  }, [selectedId, edges, run.output]);

  const selectedOutput = selectedId ? run.output[selectedId] ?? null : null;

  if (loading) {
    return <div className="empty" style={{ paddingTop: 120 }}>Loading workflow…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▲</span>
          <a href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>AI Automation</a>
        </div>
        <span className="topbar-divider" />

        <input
          className="wf-name"
          value={name}
          onChange={(e) => { dirty.current = true; setName(e.target.value); }}
          data-testid="workflow-name"
          aria-label="Workflow name"
        />

        <span className={`pill ${statusKind(status, running)}`} data-testid="save-status">
          <span className={`dot${running || status === 'saving' ? ' pulse' : ''}`} />
          {running ? 'Running' : status === 'saving' ? 'Saving' : status === 'error' ? 'Error' : status === 'saved' ? 'Saved' : 'Ready'}
        </span>
        {message && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{message}</span>}

        <div className="spacer" />

        {webhookUrl && (
          <button
            className="btn sm"
            title="Copy the webhook address"
            onClick={() => { void navigator.clipboard?.writeText(webhookUrl); flash('Webhook URL copied'); }}
          >
            <UIIcon d={UI.copy} size={13} /> Webhook URL
          </button>
        )}

        <button
          className={`btn sm${active ? ' primary' : ''}`}
          onClick={toggleActive}
          data-testid="activate"
          title="A live workflow answers its webhook and runs on its schedule"
        >
          <UIIcon d={UI.power} size={13} /> {active ? 'Active' : 'Inactive'}
        </button>

        <button className="btn sm" onClick={() => onNavigate('/executions')} title="Past runs">
          <UIIcon d={UI.list} size={13} /> Runs
        </button>

        <button className="btn sm" onClick={() => void save()} disabled={status === 'saving'} data-testid="save">
          <UIIcon d={UI.save} size={13} /> Save
        </button>

        <button
          className="btn primary"
          onClick={() => void runWorkflow()}
          disabled={running || !panelValid || nodes.length === 0}
          data-testid="run"
          title={panelValid ? 'Run this workflow now' : 'Fix the red fields first'}
        >
          <UIIcon d={UI.run} size={13} /> {running ? 'Running…' : 'Run'}
        </button>
      </header>

      <div className="workspace">
        <NodePalette descriptions={descriptions} onAdd={(d) => addNode(d)} />

        <div
          className="canvas-wrap"
          ref={canvasRef}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          data-testid="canvas"
        >
          <ReactFlow
            nodes={viewNodes}
            edges={viewEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'workflowEdge' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#232b3d" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable zoomable
              nodeColor={(n) => (byName[((n.data as any)?.node)?.type]?.colour ?? '#475569')}
              maskColor="#0a0d13cc"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div
              style={{
                position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <div className="empty">
                <div className="empty-mark">✧</div>
                Drag a trigger from the left to begin.<br />
                Every workflow starts with exactly one.
              </div>
            </div>
          )}
        </div>

        {selectedNode && byName[selectedNode.type] && (
          <ParameterPanel
            node={selectedNode}
            description={byName[selectedNode.type]}
            sampleItem={sampleItem}
            onChange={(parameters) => patchSelected({ parameters })}
            onRename={renameSelected}
            onValidity={setPanelValid}
            onToggleDisabled={(disabled) => patchSelected({ disabled })}
            onClose={() => setSelectedId(null)}
            onDelete={deleteSelected}
          />
        )}
      </div>

      <OutputPanel
        selectedName={selectedId}
        output={selectedOutput}
        log={run.log}
        height={drawerHeight}
        onHeight={setDrawerHeight}
      />

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function statusKind(status: SaveState, running: boolean) {
  if (running) return 'busy';
  if (status === 'error') return 'err';
  if (status === 'saved') return 'ok';
  return '';
}
