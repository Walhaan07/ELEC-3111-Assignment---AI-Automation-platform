import http from 'k6/http';
import { check } from 'k6';

/**
 * Workflow 3 - the read paths the editor itself hammers.
 *
 * Not a workflow at all: it measures the API under the traffic eight people
 * generate just by having the editor open, which is what makes the platform
 * feel fast or slow to use.
 */
export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 20, duration: '45s', tags: { phase: 'load' } },
  },
  thresholds: {
    'http_req_duration{phase:load}': ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const list = http.get(`${__ENV.TARGET}/rest/workflows?limit=25`);
  check(list, { 'workflows listed': (r) => r.status === 200 });

  const types = http.get(`${__ENV.TARGET}/rest/node-types`);
  check(types, { 'node types served': (r) => r.status === 200 });

  const runs = http.get(`${__ENV.TARGET}/rest/executions?limit=25`);
  check(runs, { 'executions listed': (r) => r.status === 200 });
}
