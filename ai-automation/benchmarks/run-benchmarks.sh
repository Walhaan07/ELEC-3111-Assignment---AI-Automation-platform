#!/usr/bin/env bash
# Three runs of each workflow against each platform, keeping every raw JSON
# file. The raw data is what makes the comparison credible; averages alone
# are not evidence.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p results

OURS=${OURS:-http://localhost:5678}
N8N=${N8N:-http://localhost:5679}

command -v k6 >/dev/null || { echo "k6 is not installed - see https://k6.io/docs/get-started/installation/"; exit 1; }

for script in k6/w1-webhook.js k6/w2-fanout.js k6/w3-cold-read.js; do
  name=$(basename "$script" .js)
  for run in 1 2 3; do
    echo "== $name, ours, run $run =="
    k6 run -e TARGET="$OURS" --summary-export="results/ours-$name-run$run.json" "$script" || true

    echo "== $name, n8n, run $run =="
    k6 run -e TARGET="$N8N" --summary-export="results/n8n-$name-run$run.json" "$script" || true
  done
done

echo
echo "Raw results are in benchmarks/results/. Commit every file."
echo "Then quote p(95) beside n8n's, from three runs each, with the container limits stated."
