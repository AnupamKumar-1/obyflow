#!/usr/bin/env bash
set -euo pipefail

fail=0

if ! grep -q "Cross-SDK parity" CONTRIBUTING.md; then
  echo "CONTRIBUTING.md is missing the Cross-SDK parity section"
  fail=1
fi

if [ ! -f .github/pull_request_template.md ]; then
  echo ".github/pull_request_template.md is missing"
  fail=1
elif ! grep -q "Cross-SDK parity" .github/pull_request_template.md; then
  echo ".github/pull_request_template.md is missing the Cross-SDK parity checklist"
  fail=1
fi

if grep -q "httpx2" python/obyflow-python/pyproject.toml; then
  echo "python/obyflow-python/pyproject.toml still references httpx2"
  fail=1
fi

if ! grep -q "## Versioning" README.md; then
  echo "README.md is missing the Versioning section"
  fail=1
fi

if [ ! -d fixtures/parity ]; then
  echo "fixtures/parity is missing"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "parity checks passed"
