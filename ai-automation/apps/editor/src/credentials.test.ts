import { test, expect, describe } from 'vitest';
import { credentialProblem } from './components/ParameterPanel';
import type { NodeDescription, WorkflowNode, Credential } from './types';

/**
 * The rule that decides whether a node may run.
 *
 * This is the editor's half of the credential seam: the engine reads
 * node.credentials.id, the API stores the encrypted tokens, and this stops a
 * workflow reaching the engine when the account it needs is missing.
 */

const gmailNode: NodeDescription = {
  name: 'gmail', displayName: 'Gmail', group: 'action',
  inputs: ['main'], outputs: ['main'], properties: [],
  credentials: [{ name: 'gmail', required: true }],
};

const aiNode: NodeDescription = {
  name: 'ai', displayName: 'AI', group: 'action',
  inputs: ['main'], outputs: ['main'], properties: [],
  credentials: [{ name: 'anthropicApi', required: false }],
};

const setNode: NodeDescription = {
  name: 'set', displayName: 'Set', group: 'transform',
  inputs: ['main'], outputs: ['main'], properties: [],
};

const node = (credentials?: { id: string; name?: string }): WorkflowNode =>
  ({ name: 'Gmail', type: 'gmail', parameters: {}, ...(credentials ? { credentials } : {}) });

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: 'c-1', name: 'Gmail - group account', type: 'gmail',
  connected: true, expires_at: null, ...over,
});

describe('when a node needs an account', () => {
  test('a connected credential of the right type is fine', () => {
    expect(credentialProblem(gmailNode, node({ id: 'c-1' }), [credential()])).toBeNull();
  });

  test('nothing chosen is refused, so Run stays disabled', () => {
    expect(credentialProblem(gmailNode, node(), [credential()]))
      .toMatch(/Choose a gmail credential/);
  });

  test('a credential that has been deleted says so', () => {
    expect(credentialProblem(gmailNode, node({ id: 'gone' }), [credential()]))
      .toMatch(/has been deleted/);
  });

  // The mistake this catches: connecting a Sheets-only account to Gmail, which
  // otherwise fails at run time as a bare Google 403.
  test('the wrong type of credential is caught before the workflow runs', () => {
    const sheets = credential({ id: 'c-2', name: 'Sheets', type: 'googleSheets' });
    expect(credentialProblem(gmailNode, node({ id: 'c-2' }), [sheets]))
      .toMatch(/is a googleSheets credential, not gmail/);
  });

  test('a credential added but never connected says which one', () => {
    const pending = credential({ connected: false, name: 'Gmail - mine' });
    expect(credentialProblem(gmailNode, node({ id: 'c-1' }), [pending]))
      .toMatch(/"Gmail - mine" is not connected yet/);
  });
});

describe('when a node does not need one', () => {
  test('an optional credential left empty is fine', () => {
    expect(credentialProblem(aiNode, { name: 'AI', type: 'ai', parameters: {} }, [])).toBeNull();
  });

  test('a node that declares no credentials at all is fine', () => {
    expect(credentialProblem(setNode, { name: 'Set', type: 'set', parameters: {} }, [])).toBeNull();
  });

  test('an optional credential that IS chosen is still checked', () => {
    const stale = { name: 'AI', type: 'ai', parameters: {}, credentials: { id: 'gone' } };
    expect(credentialProblem(aiNode, stale, [])).toMatch(/has been deleted/);
  });
});
