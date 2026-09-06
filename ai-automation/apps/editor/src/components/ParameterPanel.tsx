import { useEffect, useMemo } from 'react';
// The very same resolver the engine uses, so the preview cannot disagree with
// what will actually happen when the workflow runs.
import { tryResolve } from '@ai-automation/engine/expressions.js';
import type { NodeDescription, Property, WorkflowNode, Item, Credential } from '../types';
import { Icon, UI, UIIcon } from '../icons';

/**
 * One component turns any node description into a form - and validates it.
 *
 * Nobody hand-builds a settings panel. Adding a field to a node means adding a
 * line to that node's `properties` array; this file never changes.
 */

export function isVisible(p: Property, values: Record<string, unknown>): boolean {
  const { show, hide } = p.displayOptions ?? {};
  const matches = (rules: Record<string, unknown[]>) =>
    Object.entries(rules).every(([field, allowed]) => allowed.includes(values[field]));
  if (show && !matches(show)) return false;
  if (hide && matches(hide)) return false;
  return true;
}

export function validateParameter(p: Property, value: unknown): string | null {
  const isExpression = typeof value === 'string' && value.includes('{{');
  if (isExpression) return null;                    // we cannot know the value until it runs

  if (p.required && (value === '' || value === null || value === undefined)) {
    return `${p.displayName} is required`;
  }
  if (!p.required && (value === '' || value === null || value === undefined)) return null;

  const v = p.validate ?? {};
  if (v.pattern && !new RegExp(v.pattern).test(String(value ?? ''))) {
    return v.message ?? `${p.displayName} is not in the right format`;
  }
  if (p.type === 'number') {
    if (!Number.isFinite(Number(value))) return `${p.displayName} must be a number`;
    if (v.min != null && Number(value) < v.min) return `${p.displayName} must be at least ${v.min}`;
    if (v.max != null && Number(value) > v.max) return `${p.displayName} must be at most ${v.max}`;
  }
  if (p.type === 'json') {
    try {
      JSON.parse(typeof value === 'string' ? (value || '{}') : JSON.stringify(value));
    } catch {
      return `${p.displayName} is not valid JSON`;
    }
  }
  return null;
}

/**
 * Can this node run with the credential it has been given?
 *
 * Kept pure and exported so it can be tested without rendering anything: the
 * Run button is disabled from exactly this answer.
 */
export function credentialProblem(
  description: NodeDescription,
  node: WorkflowNode,
  available: Credential[],
): string | null {
  const needed = description.credentials?.[0];
  if (!needed) return null;

  const chosenId = node.credentials?.id;
  if (!chosenId) {
    return needed.required ? `Choose a ${needed.name} credential for this node` : null;
  }

  const chosen = available.find((c) => c.id === chosenId);
  if (!chosen) return 'That credential has been deleted - choose another';
  if (chosen.type !== needed.name) return `"${chosen.name}" is a ${chosen.type} credential, not ${needed.name}`;
  if (!chosen.connected) return `"${chosen.name}" is not connected yet - press Connect on the Credentials page`;
  return null;
}

export default function ParameterPanel({
  node,
  description,
  sampleItem,
  credentials,
  onChange,
  onRename,
  onValidity,
  onToggleDisabled,
  onCredentialChange,
  onClose,
  onDelete,
}: {
  node: WorkflowNode;
  description: NodeDescription;
  sampleItem: Item | null;
  credentials: Credential[];
  onChange: (parameters: Record<string, unknown>) => void;
  onRename: (name: string) => void;
  onValidity: (ok: boolean) => void;
  onToggleDisabled: (disabled: boolean) => void;
  onCredentialChange: (credential: { id: string; name: string } | undefined) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const values = useMemo(() => {
    const withDefaults: Record<string, unknown> = {};
    for (const p of description.properties) withDefaults[p.name] = p.default;
    return { ...withDefaults, ...(node.parameters ?? {}) };
  }, [description, node.parameters]);

  const visible = description.properties.filter((p) => isVisible(p, values));

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const p of visible) {
      const message = validateParameter(p, values[p.name]);
      if (message) found[p.name] = message;
    }
    return found;
  }, [visible, values]);

  const credentialError = credentialProblem(description, node, credentials);

  const errorKey = JSON.stringify(errors) + (credentialError ?? '');
  useEffect(() => {
    onValidity(Object.keys(errors).length === 0 && credentialError === null);
  }, [errorKey]);

  const set = (name: string, value: unknown) => onChange({ ...values, [name]: value });

  return (
    <aside className="side right" data-testid="parameter-panel">
      <div className="side-head">
        <span className="node-icon" style={{ background: description.colour ?? '#64748b', width: 26, height: 26 }}>
          <Icon name={description.icon} size={14} />
        </span>
        <input
          className="wf-name"
          style={{ flex: 1, fontSize: 14 }}
          value={node.name}
          onChange={(e) => onRename(e.target.value)}
          data-testid="node-name-input"
          aria-label="Node name"
        />
        <button className="btn ghost icon sm" title="Delete node" onClick={onDelete} data-testid="delete-node">
          <UIIcon d={UI.trash} size={14} />
        </button>
        <button className="btn ghost icon sm" title="Close" onClick={onClose} data-testid="close-panel">
          <UIIcon d={UI.close} size={14} />
        </button>
      </div>

      <div className="side-body">
        {description.credentials?.[0] && (
          <CredentialPicker
            needs={description.credentials[0]}
            chosenId={node.credentials?.id}
            available={credentials}
            error={credentialError}
            onChange={onCredentialChange}
          />
        )}

        {visible.length === 0 && !description.credentials?.[0] && (
          <div className="notice">This node has no settings. Connect it and press Run.</div>
        )}

        {visible.map((p) => (
          <Field
            key={p.name}
            property={p}
            value={values[p.name]}
            error={errors[p.name]}
            sampleItem={sampleItem}
            onChange={(v) => set(p.name, v)}
          />
        ))}

        <div className="field" style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label className="switch" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={Boolean(node.disabled)}
              onChange={(e) => onToggleDisabled(e.target.checked)}
              data-testid="toggle-disabled"
            />
            <span className="switch-track"><span className="switch-thumb" /></span>
            <span className="switch-text">Disable this node</span>
          </label>
          <div className="field-hint">
            A disabled node is treated as a wire: whatever arrives passes straight through it.
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * Which Google account this node acts as.
 *
 * The node declares what it needs (`credentials: [{ name: 'gmail' }]`) and this
 * offers every connected credential of that type - the same schema-driven idea
 * as the rest of the panel, so a new integration needs no work here either.
 */
function CredentialPicker({
  needs,
  chosenId,
  available,
  error,
  onChange,
}: {
  needs: { name: string; required?: boolean };
  chosenId?: string;
  available: Credential[];
  error: string | null;
  onChange: (credential: { id: string; name: string } | undefined) => void;
}) {
  const matching = available.filter((c) => c.type === needs.name);

  return (
    <div className="field" data-testid="credential-picker">
      <label className="field-label" htmlFor="credential">
        Credential
        {needs.required && <span className="req" title="required">*</span>}
      </label>

      {matching.length === 0 ? (
        <div className="notice">
          No <b>{needs.name}</b> credential yet. Open{' '}
          <a className="link" href="#/credentials">Credentials</a>, add one, and press Connect.
        </div>
      ) : (
        <select
          id="credential"
          className="select"
          aria-invalid={Boolean(error)}
          value={chosenId ?? ''}
          onChange={(e) => {
            const found = matching.find((c) => c.id === e.target.value);
            onChange(found ? { id: found.id, name: found.name } : undefined);
          }}
          data-testid="input-credential"
        >
          <option value="">Choose an account…</option>
          {matching.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.connected ? '' : ' (not connected)'}
            </option>
          ))}
        </select>
      )}

      {error && <div className="field-error" data-testid="error-credential">{error}</div>}
      {!error && chosenId && (
        <div className="field-hint">
          Tokens stay on the server, encrypted. This node only ever sees the account.
        </div>
      )}
    </div>
  );
}

/** One labelled input, with its error and its live expression preview. */
function Field({
  property,
  value,
  error,
  sampleItem,
  onChange,
}: {
  property: Property;
  value: unknown;
  error?: string;
  sampleItem: Item | null;
  onChange: (value: unknown) => void;
}) {
  const preview = previewOf(value, sampleItem);

  if (property.type === 'notice') {
    return <div className="field"><div className="notice">{String(property.default ?? '')}</div></div>;
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={`p-${property.name}`}>
        {property.displayName}
        {property.required && <span className="req" title="required">*</span>}
      </label>

      <Control property={property} value={value} error={error} onChange={onChange} />

      {error && <div className="field-error" data-testid={`error-${property.name}`}>{error}</div>}
      {!error && property.hint && <div className="field-hint">{property.hint}</div>}

      {preview && (
        <div className={`field-preview${preview.ok ? '' : ' bad'}`} data-testid={`preview-${property.name}`}>
          <div className="preview-label">{preview.ok ? 'becomes' : 'cannot resolve yet'}</div>
          {preview.text}
        </div>
      )}
    </div>
  );
}

function Control({
  property,
  value,
  error,
  onChange,
}: {
  property: Property;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const id = `p-${property.name}`;
  const invalid = Boolean(error);

  switch (property.type) {
    case 'boolean':
      return (
        <label className="switch">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={`input-${property.name}`}
          />
          <span className="switch-track"><span className="switch-thumb" /></span>
          <span className="switch-text">{value ? 'On' : 'Off'}</span>
        </label>
      );

    case 'number':
      return (
        <input
          id={id} className="input" type="number" aria-invalid={invalid}
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={property.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          data-testid={`input-${property.name}`}
        />
      );

    case 'options':
      return (
        <select
          id={id} className="select" aria-invalid={invalid}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`input-${property.name}`}
        >
          {(property.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.name}</option>
          ))}
        </select>
      );

    case 'json':
      return (
        <textarea
          id={id} className="textarea" rows={4} aria-invalid={invalid}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
          placeholder={property.placeholder ?? '{ }'}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          data-testid={`input-${property.name}`}
        />
      );

    case 'code':
      return (
        <textarea
          id={id} className="textarea code" aria-invalid={invalid}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          data-testid={`input-${property.name}`}
        />
      );

    case 'text':
      return (
        <textarea
          id={id} className="textarea" rows={4} aria-invalid={invalid}
          value={String(value ?? '')}
          placeholder={property.placeholder}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`input-${property.name}`}
        />
      );

    case 'fields':
      return <FieldsEditor value={value} onChange={onChange} />;

    case 'conditions':
      return <ConditionsEditor value={value} onChange={onChange} />;

    default:
      return (
        <input
          id={id} className="input" aria-invalid={invalid}
          value={String(value ?? '')}
          placeholder={property.placeholder}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`input-${property.name}`}
        />
      );
  }
}

/** The Set node's list of fields. */
function FieldsEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const rows = Array.isArray(value) ? (value as any[]) : [];
  const update = (i: number, patch: object) =>
    onChange(rows.map((r, index) => (index === i ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row, i) => (
        <div className="row-card" key={i}>
          <div className="row-grid">
            <input
              className="input" placeholder="Field name, e.g. customer.email"
              value={row?.name ?? ''}
              onChange={(e) => update(i, { name: e.target.value })}
              data-testid={`field-name-${i}`}
            />
            <button
              className="btn ghost icon sm" title="Remove"
              onClick={() => onChange(rows.filter((_, index) => index !== i))}
            >
              <UIIcon d={UI.trash} size={13} />
            </button>
          </div>
          <div className="row-inline" style={{ marginTop: 7 }}>
            <select
              className="select" value={row?.type ?? 'string'}
              onChange={(e) => update(i, { type: e.target.value })}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
            </select>
            <input
              className="input" placeholder="{{ $json.name }}"
              value={row?.value ?? ''}
              onChange={(e) => update(i, { value: e.target.value })}
              data-testid={`field-value-${i}`}
            />
          </div>
        </div>
      ))}
      <button
        className="btn sm"
        onClick={() => onChange([...rows, { name: '', type: 'string', value: '' }])}
        data-testid="add-field"
      >
        <UIIcon d={UI.plus} size={13} /> Add field
      </button>
    </div>
  );
}

const OPERATIONS = [
  ['equals', 'is equal to'], ['notEquals', 'is not equal to'],
  ['contains', 'contains'], ['notContains', 'does not contain'],
  ['startsWith', 'starts with'], ['endsWith', 'ends with'], ['regex', 'matches regex'],
  ['gt', 'is greater than'], ['gte', 'is greater or equal'],
  ['lt', 'is less than'], ['lte', 'is less or equal'],
  ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ['isTrue', 'is true'], ['isFalse', 'is false'],
];
const NO_RIGHT = new Set(['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse']);

/** The IF node's list of conditions. */
function ConditionsEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const rows = Array.isArray(value) ? (value as any[]) : [];
  const update = (i: number, patch: object) =>
    onChange(rows.map((r, index) => (index === i ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row, i) => (
        <div className="row-card" key={i}>
          <div className="row-grid">
            <input
              className="input" placeholder="{{ $json.status }}"
              value={row?.left ?? ''}
              onChange={(e) => update(i, { left: e.target.value })}
              data-testid={`cond-left-${i}`}
            />
            <button
              className="btn ghost icon sm" title="Remove"
              onClick={() => onChange(rows.filter((_, index) => index !== i))}
            >
              <UIIcon d={UI.trash} size={13} />
            </button>
          </div>
          <select
            className="select" style={{ marginTop: 7 }}
            value={row?.operation ?? 'equals'}
            onChange={(e) => update(i, { operation: e.target.value })}
            data-testid={`cond-op-${i}`}
          >
            {OPERATIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {!NO_RIGHT.has(row?.operation ?? 'equals') && (
            <input
              className="input" style={{ marginTop: 7 }} placeholder="paid"
              value={row?.right ?? ''}
              onChange={(e) => update(i, { right: e.target.value })}
              data-testid={`cond-right-${i}`}
            />
          )}
        </div>
      ))}
      <button
        className="btn sm"
        onClick={() => onChange([...rows, { left: '', operation: 'equals', right: '' }])}
        data-testid="add-condition"
      >
        <UIIcon d={UI.plus} size={13} /> Add condition
      </button>
    </div>
  );
}

/** Show what an expression will actually become, using the last item that ran. */
function previewOf(value: unknown, sampleItem: Item | null): { ok: boolean; text: string } | null {
  if (typeof value !== 'string' || !value.includes('{{')) return null;
  if (!sampleItem) return { ok: false, text: 'Run the workflow once to see real data here.' };

  const outcome = tryResolve(value, sampleItem, {}, 0);
  if (!outcome.ok) return { ok: false, text: outcome.error };
  const resolved = outcome.value;
  return {
    ok: true,
    text: typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved),
  };
}
