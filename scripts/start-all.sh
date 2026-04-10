#!/bin/sh
# Start script for running both API server and worker in a single container
# Usage: sh scripts/start-all.sh

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting API server..."
node dist/server.js &
API_PID=$!

echo "Starting execution worker..."
node dist/workers/executionWorker.js &
WORKER_PID=$!

echo "API server PID: $API_PID"
echo "Worker PID: $WORKER_PID"

# Handle graceful shutdown
shutdown() {
  echo "Shutting down..."
  kill $API_PID $WORKER_PID 2>/dev/null
  wait $API_PID $WORKER_PID 2>/dev/null
  exit 0
}

trap shutdown SIGTERM SIGINT

# Wait for both processes
wait
