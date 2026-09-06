/**
 * The engine is plain JavaScript - it is shared with the server, which has no
 * build step. This tells TypeScript the shape of the one function the editor
 * borrows from it, so the expression preview is typed like everything else.
 */
declare module '@ai-automation/engine/expressions.js' {
  export function resolve(
    value: unknown,
    item: { json: Record<string, unknown> } | null,
    results?: Record<string, unknown>,
    itemIndex?: number,
  ): unknown;

  export function tryResolve(
    value: unknown,
    item: { json: Record<string, unknown> } | null,
    results?: Record<string, unknown>,
    itemIndex?: number,
  ): { ok: true; value: unknown } | { ok: false; error: string };

  export function isExpression(value: unknown): boolean;
}
