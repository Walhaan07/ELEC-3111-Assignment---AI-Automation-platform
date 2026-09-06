/**
 * One error type, so every failure names its node.
 *
 * The single biggest difference between a toy engine and a usable one is that
 * when something breaks, the message says which box on the canvas broke.
 */
export class WorkflowError extends Error {
  constructor(message, { node = null, code = 'WORKFLOW_ERROR', cause = null } = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.node = node;      // which node on the canvas
    this.code = code;      // machine-readable: the editor colours the box from this
    if (cause) this.cause = cause;
  }

  // JSON.stringify(new Error('x')) is "{}" - the message would be invisible in the
  // database. Defining toJSON is what lets us store the real failure and show it later.
  toJSON() {
    return { name: this.name, code: this.code, node: this.node, message: this.message };
  }
}

/** Turn anything thrown into a plain object safe to store in a jsonb column. */
export function toErrorPayload(error) {
  if (error instanceof WorkflowError) return error.toJSON();
  return {
    name: error?.name ?? 'Error',
    code: 'UNEXPECTED_ERROR',
    node: null,
    message: String(error?.message ?? error),
  };
}
