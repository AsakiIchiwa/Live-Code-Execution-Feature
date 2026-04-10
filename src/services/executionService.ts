import { prisma, config, executionQueue, redis } from '../config';
import { sessionService } from './sessionService';
import { generateIdempotencyKey, AppError } from '../utils/helpers';

export class ExecutionService {
  /**
   * Submit code for execution.
   * Flow: validate session → check rate limit → create snapshot → check idempotency → enqueue job.
   */
  async submitExecution(sessionId: string, userId: string) {
    // 1. Validate session (ownership, active, not expired)
    const session = await sessionService.getValidSession(sessionId, userId);

    // 2. Check rate limit (executions per minute)
    await this.checkRateLimit(userId);

    // 3. Check cooldown (consecutive timeouts)
    await this.checkCooldown(userId);

    // 4. Get or create a snapshot of current code
    //    Use upsert to avoid unique constraint violation when autosave
    //    already created a snapshot at the same (sessionId, version).
    const snapshot = await prisma.codeSnapshot.upsert({
      where: {
        sessionId_version: {
          sessionId: session.id,
          version: session.version,
        },
      },
      update: {}, // snapshot already exists — reuse it
      create: {
        sessionId: session.id,
        sourceCode: session.sourceCode,
        version: session.version,
      },
    });

    // 5. Generate idempotency key — prevents duplicate execution of same code
    const idempotencyKey = generateIdempotencyKey(session.id, snapshot.id, userId);

    // 6. Check if this exact execution already exists
    const existing = await prisma.execution.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return {
        execution_id: existing.id,
        status: existing.status,
        message: 'Duplicate execution detected, returning existing result',
      };
    }

    // 7. Create execution record + log in a transaction
    const execution = await prisma.$transaction(async (tx) => {
      const exec = await tx.execution.create({
        data: {
          sessionId: session.id,
          snapshotId: snapshot.id,
          languageId: session.languageId,
          idempotencyKey,
          maxRetries: config.EXEC_MAX_RETRIES,
        },
      });

      await tx.executionLog.create({
        data: {
          executionId: exec.id,
          fromStatus: null,
          toStatus: 'QUEUED',
          metadata: { source: 'api', userId },
        },
      });

      return exec;
    });

    // 8. Enqueue job — payload is execution ID only (security: no code in Redis)
    await executionQueue.add(
      'execute-code',
      { execution_id: execution.id },
      {
        jobId: execution.id,
        priority: 1,
        removeOnComplete: { age: 3600 },
      }
    );

    // 9. Increment rate limit counter
    await this.incrementRateLimit(userId);

    return {
      execution_id: execution.id,
      status: execution.status,
    };
  }

  /** Terminal execution states eligible for caching. */
  private static readonly TERMINAL_STATES = ['COMPLETED', 'FAILED', 'TIMEOUT'];

  /** Cache TTL in seconds for terminal execution results. */
  private static readonly CACHE_TTL_SECONDS = 300;

  /**
   * Get execution result by ID.
   * Used by client polling to check execution status.
   *
   * Caching strategy:
   *   - Terminal states (COMPLETED, FAILED, TIMEOUT) are cached in Redis
   *     under the key `exec:result:{executionId}` with a 5-minute TTL.
   *   - Non-terminal states (QUEUED, RUNNING) are never cached to ensure
   *     clients always see the latest progress from PostgreSQL.
   *   - On cache hit the DB query is skipped entirely, reducing load during
   *     repeated polling after an execution finishes.
   */
  async getExecution(executionId: string) {
    const cacheKey = `exec:result:${executionId}`;

    // 1. Check Redis cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. Cache miss — query PostgreSQL
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        logs: {
          orderBy: { createdAt: 'asc' },
          select: {
            fromStatus: true,
            toStatus: true,
            createdAt: true,
          },
        },
      },
    });

    if (!execution) {
      throw new AppError(404, 'Execution not found', 'EXECUTION_NOT_FOUND');
    }

    // Base response
    const response: Record<string, unknown> = {
      execution_id: execution.id,
      session_id: execution.sessionId,
      status: execution.status,
      queued_at: execution.queuedAt,
      started_at: execution.startedAt,
      completed_at: execution.completedAt,
    };

    // Include output only when completed/failed
    if (ExecutionService.TERMINAL_STATES.includes(execution.status)) {
      response.stdout = execution.stdout;
      response.stderr = execution.stderr;
      response.exit_code = execution.exitCode;
      response.execution_time_ms = execution.executionTimeMs;
      response.memory_used_kb = execution.memoryUsedKb;
    }

    // Include lifecycle for transparency
    response.lifecycle = execution.logs;

    // 3. Cache terminal results in Redis so subsequent polls skip the DB
    if (ExecutionService.TERMINAL_STATES.includes(execution.status)) {
      await redis.set(
        cacheKey,
        JSON.stringify(response),
        'EX',
        ExecutionService.CACHE_TTL_SECONDS
      );
    }

    return response;
  }

  /**
   * List executions for a session. Useful for execution history view.
   */
  async listBySession(sessionId: string, limit = 20) {
    return prisma.execution.findMany({
      where: { sessionId },
      orderBy: { queuedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        executionTimeMs: true,
        queuedAt: true,
        completedAt: true,
      },
    });
  }

  /**
   * Rate limiting using Redis sliding window.
   * Blocks user if they exceed max executions per minute.
   */
  private async checkRateLimit(userId: string) {
    const key = `rate:exec:${userId}`;
    const count = await redis.get(key);
    
    if (count && parseInt(count) >= config.RATE_LIMIT_EXECUTIONS_PER_MINUTE) {
      throw new AppError(429, 
        `Rate limit exceeded: max ${config.RATE_LIMIT_EXECUTIONS_PER_MINUTE} executions per minute`,
        'RATE_LIMIT_EXCEEDED'
      );
    }
  }

  private async incrementRateLimit(userId: string) {
    const key = `rate:exec:${userId}`;
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, 60);
    await multi.exec();
  }

  /**
   * Cooldown check: if user has N consecutive timeouts, block for cooldown period.
   * Prevents abuse via repeated infinite loop submissions.
   */
  private async checkCooldown(userId: string) {
    const cooldownKey = `cooldown:${userId}`;
    const cooldownUntil = await redis.get(cooldownKey);

    if (cooldownUntil && Date.now() < parseInt(cooldownUntil)) {
      const remainingSecs = Math.ceil((parseInt(cooldownUntil) - Date.now()) / 1000);
      throw new AppError(429, 
        `Cooldown active: too many timeouts. Try again in ${remainingSecs}s`,
        'COOLDOWN_ACTIVE'
      );
    }
  }

  /**
   * Track consecutive timeouts per user. Called by worker after timeout.
   */
  async trackTimeout(userId: string) {
    const key = `timeout:streak:${userId}`;
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, 300); // 5 min window
    const results = await multi.exec();

    const streak = results?.[0]?.[1] as number;
    if (streak >= config.RATE_LIMIT_COOLDOWN_AFTER_TIMEOUTS) {
      const cooldownUntil = Date.now() + config.RATE_LIMIT_COOLDOWN_SECONDS * 1000;
      await redis.set(`cooldown:${userId}`, cooldownUntil.toString(), 'EX', config.RATE_LIMIT_COOLDOWN_SECONDS);
      await redis.del(key); // Reset streak
    }
  }

  /**
   * Reset timeout streak. Called by worker after successful execution.
   */
  async resetTimeoutStreak(userId: string) {
    await redis.del(`timeout:streak:${userId}`);
  }
}

export const executionService = new ExecutionService();
