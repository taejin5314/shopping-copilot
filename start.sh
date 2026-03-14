#!/bin/sh
# Start ikea-mcp HTTP server in background, wait until healthy, then start shopping-copilot.
set -e

# Find ikea-mcp's http entrypoint (globally installed)
IKEA_HTTP="$(dirname "$(readlink -f "$(which ikea-mcp)")")/http.js"

echo "Starting ikea-mcp HTTP on port 3000..."
PORT=3000 node "$IKEA_HTTP" &
MCP_PID=$!

# Wait for ikea-mcp health endpoint (up to 30 seconds)
attempts=0
max_attempts=30
until wget -q -O /dev/null http://localhost:3000/health 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ $attempts -ge $max_attempts ]; then
    echo "WARNING: ikea-mcp did not become healthy after ${max_attempts}s, starting anyway"
    break
  fi
  sleep 1
done

if [ $attempts -lt $max_attempts ]; then
  echo "ikea-mcp is healthy after ${attempts}s"
fi

echo "Starting shopping-copilot on port ${PORT:-4000}..."
exec node dist/api/http.js
