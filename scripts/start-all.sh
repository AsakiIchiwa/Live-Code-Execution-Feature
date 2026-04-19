#!/bin/sh
# Start script for running both API server and worker in a single container
# Usage: sh scripts/start-all.sh

echo "Running database migrations..."

# Resolve any previously failed migrations
npx prisma migrate resolve --rolled-back 20260419034633_add_full_features 2>/dev/null || true
npx prisma migrate resolve --rolled-back 20260419042842_add_marketplace_and_soft_delete 2>/dev/null || true

npx prisma migrate deploy

# Only seed if RUN_SEED=true (set this on first deploy only, then remove it)
if [ "$RUN_SEED" = "true" ]; then
  echo "Seeding database..."
  npx tsx prisma/seed.ts
  echo "Database seeded."
else
  echo "Skipping seed (set RUN_SEED=true to seed)"
fi

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

trap shutdown SIGTERM SIGINT SIGHUP

# Wait for any process to exit
wait -n $API_PID $WORKER_PID 2>/dev/null || wait $API_PID
EXIT_CODE=$?

echo "Process exited with code $EXIT_CODE, shutting down..."
shutdown
