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
    echo "  cd $SIDECAR_DIR && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
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
for _ in {1..10}; do
    if curl -s http://127.0.0.1:8008/api/health > /dev/null 2>&1; then
        echo "Sidecar is ready!"
        break
    fi
    sleep 1
done

# Start Tauri dev
echo "[2/2] Starting Tauri GUI..."
cd "$SCRIPT_DIR"
npm run tauri dev

# Wait for cleanup
wait
