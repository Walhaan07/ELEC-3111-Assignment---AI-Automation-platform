import { EventEmitter } from 'node:events';

/**
 * Live progress, so the canvas can light a node up while it is running.
 *
 * The engine calls `onEvent` for every node it starts and finishes; the runner
 * publishes those here; `GET /rest/workflows/:id/events` streams them to the
 * browser with Server-Sent Events. No websocket library, no polling.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function publish(workflowId, event) {
  bus.emit(`workflow:${workflowId}`, event);
  bus.emit('workflow:*', { workflowId, ...event });
}

/**
 * Express handler. Kept here so the route file stays a list of routes.
 */
export function streamEvents(req, res) {
  const workflowId = req.params.id;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',        // stops nginx-style proxies buffering the stream
  });
  res.write(': connected\n\n');

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const channel = `workflow:${workflowId}`;
  bus.on(channel, send);

  // a proxy that sees nothing for 60 s will close the connection, so say hello
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off(channel, send);
  });
}
