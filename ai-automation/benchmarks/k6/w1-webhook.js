import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

/**
 * Workflow 1 - webhook in, one transform, a reply.
 *
 * Run against ours and against n8n with the same script, three times each:
 *   k6 run -e TARGET=http://localhost:5678 --summary-export=results/ours-w1-run1.json benchmarks/k6/w1-webhook.js
 *   k6 run -e TARGET=http://localhost:5679 --summary-export=results/n8n-w1-run1.json  benchmarks/k6/w1-webhook.js
 */
const e2e = new Trend('workflow_end_to_end_ms');
const failed = new Rate('workflow_failed');

export const options = {
  scenarios: {
    warmup: { executor: 'constant-vus', vus: 2, duration: '20s', tags: { phase: 'warmup' } },
    load: {
      executor: 'constant-vus', vus: 10, duration: '60s', startTime: '25s',
      gracefulStop: '10s', tags: { phase: 'load' },
    },
  },
  // the run FAILS if these are missed, so a bad result cannot quietly be reported as good
  thresholds: {
    'http_req_duration{phase:load}': ['p(95)<1000', 'p(99)<2500'],
    workflow_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const started = Date.now();
  const res = http.post(
    `${__ENV.TARGET}/webhook/${__ENV.HOOK || 'bench-w1'}`,
    JSON.stringify({ id: __VU, iteration: __ITER, ts: started }),
    { headers: { 'content-type': 'application/json' }, timeout: '30s' },
  );

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body came back': (r) => String(r.body).length > 2,
  });

  failed.add(!ok);
  e2e.add(Date.now() - started);
}
