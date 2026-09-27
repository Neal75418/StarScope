#!/bin/bash
# StarScope Development Startup Script
# Starts both the Python sidecar (backend) and Tauri GUI (frontend)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/sidecar"

# Cleanup function to kill sidecar when script exits
cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -n "$SIDECAR_PID" ]; then
        kill $SIDECAR_PID 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Kill any existing process on port 8008
lsof -ti:8008 | xargs kill -9 2>/dev/null || true

echo "=== Starting StarScope Development Environment ==="

# Check if virtual environment exists
if [ ! -d "$SIDECAR_DIR/.venv" ]; then
    echo "Error: Virtual environment not found. Please run:"
    # 版本以 repo 根目錄的 .python-version 為準（系統 python3 在 macOS 是 3.9，缺 StrEnum）
    echo "  cd $SIDECAR_DIR && python$(cat "$SCRIPT_DIR/.python-version") -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt -c constraints.txt"
    exit 1
fi

# Start sidecar in background
echo "[1/2] Starting Python sidecar..."
cd "$SIDECAR_DIR"
source .venv/bin/activate
python main.py &
SIDECAR_PID=$!

# Wait for sidecar to be ready
echo "Waiting for sidecar to start..."
SIDECAR_READY=false
for _ in {1..10}; do
    if curl -s http://127.0.0.1:8008/api/health > /dev/null 2>&1; then
        echo "Sidecar is ready!"
        SIDECAR_READY=true
        break
    fi
    sleep 1
done

if [ "$SIDECAR_READY" = false ]; then
    echo "Error: Sidecar failed to start within 10 seconds"
    exit 1
fi

# Start Tauri dev
echo "[2/2] Starting Tauri GUI..."
cd "$SCRIPT_DIR"
npm run tauri dev

# Wait for cleanup
wait
