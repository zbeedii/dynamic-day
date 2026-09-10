#!/usr/bin/env bash
set -euo pipefail
: "${MONGO_URL:?Set MONGO_URL first}"
OUT="${1:-./backups/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
mongodump --uri="$MONGO_URL" --out="$OUT"
echo "Backup written to $OUT"
