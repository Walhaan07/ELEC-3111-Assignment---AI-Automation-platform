/**
 * One place that collects every node type that exists.
 *
 * This is the only file a new node is ever added to: import it, add one line.
 * The API serves `description` from here to the editor, which builds the
 * palette and every settings panel from it - so a new node needs no UI work.
 */
import { manualTrigger, webhookTrigger, scheduleTrigger } from './core/triggers.js';
import { httpRequestNode } from './core/httpRequest.js';
import { setNode } from './core/set.js';
import { ifNode } from './core/if.js';
import { mergeNode } from './core/merge.js';
import { codeNode } from './core/code.js';
import { sheetsNode } from './google/sheets.js';
import { docsNode } from './google/docs.js';
import { driveNode } from './google/drive.js';
import { gmailNode } from './google/gmail.js';
import { aiNode } from './ai/llm.js';

export const nodeTypes = {
  // triggers
  manualTrigger,
  webhook: webhookTrigger,
  schedule: scheduleTrigger,
  // core
  httpRequest: httpRequestNode,
  set: setNode,
  if: ifNode,
  merge: mergeNode,
  code: codeNode,
  // Google Workspace
  googleSheets: sheetsNode,
  googleDocs: docsNode,
  googleDrive: driveNode,
  gmail: gmailNode,
  // AI
  ai: aiNode,
};

/** Exactly what the editor needs: every description, and nothing executable. */
export const nodeDescriptions = () =>
  Object.entries(nodeTypes).map(([type, node]) => ({ ...node.description, name: type }));

export { useCredentialStore, forgetCredential, googleRequest } from './google/request.js';
