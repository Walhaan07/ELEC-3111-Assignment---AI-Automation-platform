import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Workflow 2 - one webhook that fans out to fifty items, then batches them
 * into a single downstream write.
 *
 * This is the measurement worth quoting: it is where our "collect first, send
 * once" Sheets node stops being a design opinion and becomes a number.
 */
const e2e = new Trend('workflow_end_to_end_ms');

export const options = {
  scenarios: {
    load: { executor: 'constant-vus', vus: 5, duration: '60s', tags: { phase: 'load' } },
  },
  thresholds: {
    'http_req_duration{phase:load}': ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const started = Date.now();
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `${__VU}-${__ITER}-${i}`, amount: i }));

  const res = http.post(
    `${__ENV.TARGET}/webhook/${__ENV.HOOK || 'bench-w2'}`,
    JSON.stringify({ rows }),
    { headers: { 'content-type': 'application/json' }, timeout: '60s' },
  );

  check(res, { 'status is 200': (r) => r.status === 200 });
  e2e.add(Date.now() - started);
}
