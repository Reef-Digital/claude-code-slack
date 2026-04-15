#!/bin/bash
# Run the mandatory pre-commit sequence and create the gate file if all pass
# Usage: bash claude-code-slack/hooks/pass-gate.sh <repo-dir>

REPO_DIR="${1:-.}"
GATE_FILE="/tmp/claude-pre-commit-gate.json"

cd "$REPO_DIR" || exit 1

echo "=== Pre-commit gate: $REPO_DIR ==="

# Pick the package manager. Bun-native repos (bun.lock, no package-lock.json)
# use bun; everything else uses npm.
if [ -f "bun.lock" ] && [ ! -f "package-lock.json" ]; then
  INSTALL_CMD="bun install --frozen-lockfile"
  BUILD_CMD="bun run build"
  TEST_CMD="bun test"
  PM="bun"
else
  INSTALL_CMD="npm ci --silent"
  BUILD_CMD="npm run build"
  TEST_CMD="npm run test"
  PM="npm"
fi

echo "[1/3] $PM install..."
if ! eval "$INSTALL_CMD" 2>&1; then
  echo "FAILED: $INSTALL_CMD"
  rm -f "$GATE_FILE"
  exit 1
fi

echo "[2/3] build..."
if ! eval "$BUILD_CMD" 2>&1; then
  echo "FAILED: $BUILD_CMD"
  rm -f "$GATE_FILE"
  exit 1
fi

echo "[3/3] test..."
if ! eval "$TEST_CMD" 2>&1; then
  echo "FAILED: $TEST_CMD"
  rm -f "$GATE_FILE"
  exit 1
fi

# All passed — create gate file
echo "{\"repo\": \"$(basename "$REPO_DIR")\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"passed\": true}" > "$GATE_FILE"
echo "=== Gate PASSED at $(date) ==="
