export type PropertyType =
  | 'string' | 'text' | 'number' | 'boolean' | 'options'
  | 'json' | 'code' | 'fields' | 'conditions' | 'notice';

export type PropertyOption = { name: string; value: string };

export type Property = {
  displayName: string;
  name: string;
  type: PropertyType;
  default?: unknown;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: PropertyOption[];
  displayOptions?: { show?: Record<string, unknown[]>; hide?: Record<string, unknown[]> };
  validate?: { pattern?: string; message?: string; min?: number; max?: number };
};

export type NodeDescription = {
  name: string;
  displayName: string;
  group: 'trigger' | 'action' | 'transform' | 'flow';
  description?: string;
  icon?: string;
  colour?: string;
  inputs: string[];
  outputs: string[];
  credentials?: { name: string; required?: boolean }[];
  properties: Property[];
};

export type WorkflowNode = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  position?: { x: number; y: number };
  disabled?: boolean;
  continueOnFail?: boolean;
  notes?: string;
  credentials?: { id: string; name?: string };
};

export type Workflow = {
  id?: string;
  name: string;
  active?: boolean;
  version?: number;
  nodes: WorkflowNode[];
  connections: Record<string, string[][]>;
  webhookUrl?: string | null;
};

export type Item = { json: Record<string, unknown>; error?: string };

export type RunResult = {
  executionId: string;
  status: 'success' | 'error';
  data?: Record<string, Item[][]>;
  log?: LogLine[];
  error?: { message: string; code: string; node: string | null };
};

export type LogLine = {
  node: string;
  level: 'info' | 'warn' | 'done' | 'error' | 'skipped' | 'disabled';
  ms?: number;
  items?: number;
  msg?: string;
};

export type NodeRunState = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type LiveEvent =
  | { type: 'execution-started'; executionId: string; mode: string }
  | { type: 'node-started'; node: string }
  | { type: 'node-finished'; node: string; ms: number; items: number; preview: Item[][] }
  | { type: 'node-error'; node: string; ms: number; message: string }
  | { type: 'node-skipped'; node: string }
  | { type: 'node-log'; node: string; msg: string }
  | { type: 'execution-finished'; executionId: string; status: string; ms: number };

export type Credential = {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  expires_at: string | null;
};

export type ExecutionSummary = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  mode: 'manual' | 'webhook' | 'schedule';
  status: 'running' | 'success' | 'error' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  ms: number | null;
  error?: { message: string; node: string | null } | null;
};
