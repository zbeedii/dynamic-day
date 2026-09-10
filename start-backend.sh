#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 8000
