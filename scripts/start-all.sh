#!/bin/sh
# Start script for running both API server and worker in a single container
# Usage: sh scripts/start-all.sh

echo "Running database migrations..."
npx prisma migrate deploy

echo "Seeding database (idempotent - safe to run multiple times)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function seed() {
  const languages = [
    { id: 'lang-python', name: 'python', version: '3.12', dockerImage: 'python:3.12-alpine', fileExtension: '.py', isActive: true },
    { id: 'lang-javascript', name: 'javascript', version: '20', dockerImage: 'node:20-alpine', fileExtension: '.js', isActive: true },
    { id: 'lang-typescript', name: 'typescript', version: '5.x', dockerImage: 'node:20-alpine', fileExtension: '.ts', isActive: true },
    { id: 'lang-java', name: 'java', version: '21', dockerImage: 'eclipse-temurin:21-alpine', fileExtension: '.java', isActive: true },
  ];
  for (const lang of languages) {
    await prisma.supportedLanguage.upsert({ where: { id: lang.id }, update: {}, create: lang });
  }
  console.log('Seeded ' + languages.length + ' languages');
  await prisma.\$disconnect();
}
seed().catch(e => { console.error(e); process.exit(1); });
"
echo "Database seeded."

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
