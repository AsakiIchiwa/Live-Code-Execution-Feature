import { Worker, Job } from 'bullmq';
import { config, prisma, redisConnection } from '../config';
import { sandboxService } from '../services/sandboxService';
import { executionService } from '../services/executionService';
import { randomUUID } from 'crypto';

const WORKER_ID = `worker-${randomUUID().substring(0, 8)}`;

interface ExecutionJobData {
  execution_id: string;
}

/**
 * Process a single execution job.
 *
 * Flow:
 * 1. Fetch execution record from DB
 * 2. Verify status is QUEUED (prevents replay/duplicate processing)
 * 3. Atomically claim the job (UPDATE WHERE status = 'QUEUED')
 * 4. Fetch source code from snapshot
 * 5. Execute in sandbox
 * 6. Update result in DB
 * 7. Track timeout streaks for abuse prevention
 */
export async function processJob(job: Job<ExecutionJobData>) {
  const { execution_id } = job.data;
  const logger = console; // In production: use pino

  logger.log(`[${WORKER_ID}] Processing execution ${execution_id}`);

  // 1. Fetch execution with related data
  const execution = await prisma.execution.findUnique({
    where: { id: execution_id },
    include: {
      snapshot: true,
      language: true,
      session: { select: { userId: true } },
    },
  });

  if (!execution) {
    logger.error(`[${WORKER_ID}] Execution ${execution_id} not found, skipping`);
    return;
  }

  // 2. Verify status — another worker may have already claimed it
  if (execution.status !== 'QUEUED') {
    logger.warn(`[${WORKER_ID}] Execution ${execution_id} is ${execution.status}, skipping`);
    return;
  }

  // 3. Atomically claim: UPDATE WHERE status = 'QUEUED'
  //    If affected rows = 0, another worker got it first
  const claimed = await prisma.execution.updateMany({
    where: { id: execution_id, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      workerId: WORKER_ID,
      startedAt: new Date(),
    },
  });

  if (claimed.count === 0) {
    logger.warn(`[${WORKER_ID}] Failed to claim execution ${execution_id}, another worker got it`);
    return;
  }

  // Log state transition: QUEUED → RUNNING
  await prisma.executionLog.create({
    data: {
      executionId: execution_id,
      fromStatus: 'QUEUED',
      toStatus: 'RUNNING',
      workerId: WORKER_ID,
      metadata: { jobId: job.id, attempt: job.attemptsMade + 1 },
    },
  });

  // 4. Execute code in sandbox
  try {
    const result = await sandboxService.execute(execution.snapshot.sourceCode, {
      name: execution.language.name,
      version: execution.language.version,
      fileExtension: execution.language.fileExtension,
      maxTimeoutMs: execution.language.maxTimeoutMs,
      maxMemoryKb: execution.language.maxMemoryKb,
    });

    // 5. Determine final status
    let finalStatus: 'COMPLETED' | 'FAILED' | 'TIMEOUT';
    if (result.timedOut) {
      finalStatus = 'TIMEOUT';
    } else if (result.exitCode !== 0) {
      finalStatus = 'FAILED';
    } else {
      finalStatus = 'COMPLETED';
    }

    // 6. Update execution result
    await prisma.execution.update({
      where: { id: execution_id },
      data: {
        status: finalStatus,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTimeMs: result.executionTimeMs,
        memoryUsedKb: result.memoryUsedKb,
        completedAt: new Date(),
      },
    });

    // Log state transition: RUNNING → final
    await prisma.executionLog.create({
      data: {
        executionId: execution_id,
        fromStatus: 'RUNNING',
        toStatus: finalStatus,
        workerId: WORKER_ID,
        metadata: {
          executionTimeMs: result.executionTimeMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        },
      },
    });

    // 7. Track timeout streaks for abuse prevention
    if (finalStatus === 'TIMEOUT') {
      await executionService.trackTimeout(execution.session.userId);
    } else {
      await executionService.resetTimeoutStreak(execution.session.userId);
    }

    logger.log(`[${WORKER_ID}] Execution ${execution_id} → ${finalStatus} (${result.executionTimeMs}ms)`);
  } catch (error) {
    // Unexpected worker error
    const errMsg = error instanceof Error ? error.message : 'Unknown worker error';

    await prisma.execution.update({
      where: { id: execution_id },
      data: {
        status: 'FAILED',
        stderr: `Worker error: ${errMsg}`,
        exitCode: -1,
        completedAt: new Date(),
      },
    });

    await prisma.executionLog.create({
      data: {
        executionId: execution_id,
        fromStatus: 'RUNNING',
        toStatus: 'FAILED',
        workerId: WORKER_ID,
        metadata: { error: errMsg, type: 'worker_crash' },
      },
    });

    // Re-throw to trigger BullMQ retry if attempts remain
    throw error;
  }
}

// Start Worker

/**
 * Create and start a BullMQ worker. Returns the worker instance for cleanup.
 */
export function startWorker() {
  const worker = new Worker(config.QUEUE_NAME, processJob, {
    connection: redisConnection,
    concurrency: config.QUEUE_CONCURRENCY,
    limiter: {
      max: 10,
      duration: 1000, // Max 10 jobs per second per worker
    },
  });

  worker.on('ready', () => {
    console.log(`Worker ${WORKER_ID} ready, concurrency=${config.QUEUE_CONCURRENCY}`);
  });

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  return worker;
}

// Only start when run directly (not imported for testing)
const isMainModule = require.main === module || process.argv[1]?.endsWith('executionWorker.ts') || process.argv[1]?.endsWith('executionWorker.js');
if (isMainModule) {
  const worker = startWorker();

  // Graceful shutdown
  async function shutdown() {
    console.log(`\nShutting down worker ${WORKER_ID}...`);
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`Worker ${WORKER_ID} starting on queue "${config.QUEUE_NAME}"...`);
}
