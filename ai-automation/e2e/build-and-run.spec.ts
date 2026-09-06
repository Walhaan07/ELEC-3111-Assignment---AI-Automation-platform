import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * One browser test, walking every seam in the system:
 *
 *   canvas  ->  server  ->  engine  ->  node  ->  back to the canvas
 *
 * Browser tests are slow and break for boring reasons, so there is exactly
 * one. It covers the path a marker will actually click through.
 */

const API = 'http://localhost:5678';

/** Everything this file creates, so it can tidy up after itself. */
const created: string[] = [];

async function newWorkflow(request: APIRequestContext, name: string) {
  // start from a known state: make the workflow through the API, not by clicking
  const response = await request.post(`${API}/rest/workflows`, {
    data: { name, nodes: [], connections: {} },
  });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).id as string;
  created.push(id);
  return id;
}

// A test that leaves rows behind turns the workflow list into a wall of
// "e2e 1788714212909" after a few runs, and buries the real workflows.
test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  for (const id of created.splice(0)) {
    await request.delete(`${API}/rest/workflows/${id}`).catch(() => {});
  }
  await request.dispose();
});

/**
 * Wait until the canvas has stopped moving.
 *
 * Adding a node from the palette slides the view to show it. Measuring a
 * handle while that is still animating gives coordinates that are already
 * stale by the time the mouse gets there - which is exactly the kind of
 * boring reason browser tests turn flaky.
 */
async function canvasIsStill(page: Page) {
  const transform = async () =>
    page.locator('.react-flow__viewport').getAttribute('style');
  let previous = await transform();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(60);
    const now = await transform();
    if (now === previous) return;
    previous = now;
  }
}

/**
 * Drag from an output dot to an input dot, the way a person would.
 *
 * The drop has to land on the input handle itself - React Flow only snaps to a
 * handle within about 20 pixels, so aiming at the middle of the box misses.
 */
async function connect(page: Page, fromHandle: string, toHandle: string) {
  await canvasIsStill(page);
  const source = page.getByTestId(fromHandle);
  const target = page.getByTestId(toHandle);
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('handle or target is not on screen');

  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 24, a.y + a.height / 2, { steps: 4 });  // start the line
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
}

test('draw two nodes, connect them, run, and see the result', async ({ page, request }) => {
  const id = await newWorkflow(request, `e2e ${Date.now()}`);
  await page.goto(`/#/workflow/${id}`);

  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('palette')).toBeVisible();

  // 1 - build the workflow by clicking, exactly as a person would
  await page.getByTestId('palette-manualTrigger').click();
  await expect(page.getByTestId('node-Manual Trigger')).toBeVisible();

  await page.getByTestId('palette-set').click();
  await expect(page.getByTestId('node-Set')).toBeVisible();

  // 2 - drag an arrow from the trigger's output dot onto the Set node's input dot
  await connect(page, 'handle-Manual Trigger-0', 'target-Set');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // 3 - the settings panel drew itself from the node's own description
  await page.getByTestId('node-Set').click();
  await expect(page.getByTestId('parameter-panel')).toContainText('Keep only set fields');
  await expect(page.getByTestId('parameter-panel')).toContainText('Fields');

  await page.getByTestId('add-field').click();
  await page.getByTestId('field-name-0').fill('greeting');
  await page.getByTestId('field-value-0').fill('hello from the browser test');
  await page.keyboard.press('Escape');          // close the panel, back to the canvas

  // 4 - save, and confirm the server accepted it
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  const saved = await (await request.get(`${API}/rest/workflows/${id}`)).json();
  expect(saved.connections).toEqual({ 'Manual Trigger': [['Set']] });

  // 5 - run it, and watch the boxes report back
  await page.getByTestId('run').click();
  await expect(page.getByTestId('node-Set')).toHaveAttribute('data-state', 'success');
  await expect(page.getByTestId('node-Manual Trigger')).toHaveAttribute('data-state', 'success');

  await page.getByTestId('node-Set').click();
  await expect(page.getByTestId('output-Set')).toContainText('hello from the browser test');

  // 6 - it really persisted. This is the bug the test exists to catch.
  await page.reload();
  await expect(page.getByTestId('node-Set')).toBeVisible();
  await expect(page.getByTestId('node-Manual Trigger')).toBeVisible();
  expect(await page.locator('.react-flow__edge').count()).toBe(1);
});

test('a workflow that cannot run says so, and names the node', async ({ page, request }) => {
  const id = await newWorkflow(request, `e2e bad ${Date.now()}`);
  await page.goto(`/#/workflow/${id}`);

  await page.getByTestId('palette-manualTrigger').click();
  await page.getByTestId('palette-httpRequest').click();
  await connect(page, 'handle-Manual Trigger-0', 'target-HTTP Request');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // an address that is not an address
  await page.getByTestId('node-HTTP Request').click();
  await page.getByTestId('input-url').fill('ftp://example.com');
  await expect(page.getByTestId('error-url')).toContainText('must start with http');

  // the panel is red, so Run is not even offered
  await expect(page.getByTestId('run')).toBeDisabled();

  // fix it to something that fails at request time instead
  await page.getByTestId('input-url').fill('http://127.0.0.1:9/nothing');
  await page.getByTestId('input-retries').fill('0');
  await page.getByTestId('input-timeout').fill('1000');
  await expect(page.getByTestId('run')).toBeEnabled();

  await page.getByTestId('run').click();
  await expect(page.getByTestId('node-HTTP Request')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('save-status')).toContainText('Error');
});
