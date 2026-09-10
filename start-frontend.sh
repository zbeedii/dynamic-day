#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/frontend"
yarn install
yarn start
