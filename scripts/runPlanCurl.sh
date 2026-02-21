#!/usr/bin/env bash
set -euo pipefail

REQ_FILE="${1:-examples/plan-request.sample.json}"
API_URL="${2:-http://localhost:3000/api/plan}"

if [ ! -f "$REQ_FILE" ]; then
  echo "request file not found: $REQ_FILE" >&2
  exit 1
fi

curl -sS -X POST "$API_URL" \
  -H 'Content-Type: application/json' \
  --data-binary "@$REQ_FILE"
