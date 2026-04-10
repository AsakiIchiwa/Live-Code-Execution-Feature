import { FastifyInstance } from 'fastify';
import { sessionController } from '../controllers/sessionController';
import { executionController } from '../controllers/executionController';
import { executionQueue, redis, prisma } from '../config';

// -- Reusable schema fragments --

const errorResponse = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
    message: { type: 'string' as const },
  },
};

const validationErrorResponse = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const, example: 'VALIDATION_ERROR' },
    message: { type: 'string' as const, example: 'Invalid request data' },
    details: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          field: { type: 'string' as const },
          message: { type: 'string' as const },
        },
      },
    },
  },
};

const sessionIdParam = {
  type: 'object' as const,
  required: ['session_id'],
  properties: {
    session_id: { type: 'string' as const, format: 'uuid', description: 'Code session UUID' },
  },
};

const executionIdParam = {
  type: 'object' as const,
  required: ['execution_id'],
  properties: {
    execution_id: { type: 'string' as const, format: 'uuid', description: 'Execution UUID' },
  },
};

const userIdHeader = {
  type: 'object' as const,
  properties: {
    'x-user-id': { type: 'string' as const, format: 'uuid', description: 'Authenticated user UUID' },
  },
};

/**
 * Register all API routes.
 * Prefix: /api/v1
 */
export async function registerRoutes(app: FastifyInstance) {
  // Health Check
  app.get('/health', {
    schema: {
      description: 'Returns the current server health status, timestamp, and uptime.',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          description: 'Server is healthy',
          properties: {
            status: { type: 'string', example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number', description: 'Process uptime in seconds' },
          },
        },
      },
    },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // Worker Health Check
  app.get('/health/worker', {
    schema: {
      description: 'Returns the health status of the background worker, including queue job counts, Redis connectivity, and database connectivity.',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          description: 'Worker health status',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
            timestamp: { type: 'string', format: 'date-time' },
            queue: {
              type: 'object',
              properties: {
                waiting: { type: 'integer' },
                active: { type: 'integer' },
                completed: { type: 'integer' },
                failed: { type: 'integer' },
                delayed: { type: 'integer' },
              },
            },
            redis: { type: 'string', example: 'connected' },
            database: { type: 'string', example: 'connected' },
          },
        },
      },
    },
  }, async () => {
    let status: 'ok' | 'degraded' = 'ok';
    const result: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    // Queue status
    try {
      const counts = await executionQueue.getJobCounts();
      result.queue = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    } catch (err) {
      status = 'degraded';
      result.queue = { error: err instanceof Error ? err.message : 'Unknown error' };
    }

    // Redis connectivity
    try {
      await redis.ping();
      result.redis = 'connected';
    } catch (err) {
      status = 'degraded';
      result.redis = `error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }

    // Database connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      result.database = 'connected';
    } catch (err) {
      status = 'degraded';
      result.database = `error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }

    result.status = status;
    return result;
  });

  // POST /api/v1/code-sessions -- Create session
  app.post('/api/v1/code-sessions', {
    schema: {
      description: 'Create a new live coding session for a simulation. '
        + 'The language must be a supported and active language.',
      tags: ['Sessions'],
      body: {
        type: 'object',
        required: ['simulation_id', 'user_id', 'language'],
        properties: {
          simulation_id: { type: 'string', format: 'uuid', description: 'Simulation this session belongs to' },
          user_id: { type: 'string', format: 'uuid', description: 'Owner user UUID' },
          language: { type: 'string', minLength: 1, maxLength: 20, description: 'Programming language name (e.g. "python", "javascript")' },
          template_code: { type: 'string', maxLength: 51200, default: '', description: 'Optional starter code template' },
        },
      },
      response: {
        201: {
          type: 'object',
          description: 'Session created successfully',
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED'] },
            language: { type: 'string' },
            language_version: { type: 'string' },
            expires_at: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        400: {
          description: 'Validation error or unsupported language',
          ...validationErrorResponse,
        },
      },
    },
  }, (req, rep) => sessionController.create(req, rep));

  // PATCH /api/v1/code-sessions/:session_id -- Autosave code
  app.patch('/api/v1/code-sessions/:session_id', {
    schema: {
      description: 'Autosave the current source code for a session. '
        + 'Uses optimistic locking via the version field to prevent stale writes.',
      tags: ['Sessions'],
      headers: userIdHeader,
      params: sessionIdParam,
      body: {
        type: 'object',
        required: ['source_code', 'version'],
        properties: {
          source_code: { type: 'string', maxLength: 51200, description: 'Updated source code' },
          version: { type: 'integer', minimum: 1, description: 'Current version number for optimistic locking' },
        },
      },
      response: {
        200: {
          type: 'object',
          description: 'Code saved successfully',
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED'] },
            version: { type: 'integer' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        400: {
          description: 'Validation error or session not active',
          ...validationErrorResponse,
        },
        401: {
          description: 'Missing x-user-id header',
          ...errorResponse,
        },
        403: {
          description: 'User does not own this session',
          ...errorResponse,
        },
        404: {
          description: 'Session not found',
          ...errorResponse,
        },
        409: {
          description: 'Version conflict -- refetch and retry',
          ...errorResponse,
        },
      },
    },
  }, (req, rep) => sessionController.autosave(req, rep));

  // GET /api/v1/code-sessions/:session_id -- Get session details
  app.get('/api/v1/code-sessions/:session_id', {
    schema: {
      description: 'Retrieve full details of a code session by its ID.',
      tags: ['Sessions'],
      params: sessionIdParam,
      response: {
        200: {
          type: 'object',
          description: 'Session details',
          properties: {
            session_id: { type: 'string', format: 'uuid' },
            simulation_id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            language: { type: 'string' },
            language_version: { type: 'string' },
            source_code: { type: 'string' },
            status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED'] },
            version: { type: 'integer' },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        404: {
          description: 'Session not found',
          ...errorResponse,
        },
      },
    },
  }, (req, rep) => sessionController.getById(req, rep));

  // POST /api/v1/code-sessions/:session_id/run -- Run code
  app.post('/api/v1/code-sessions/:session_id/run', {
    schema: {
      description: 'Submit the current session code for sandboxed execution. '
        + 'The code is queued and executed asynchronously. '
        + 'Includes idempotency to prevent duplicate submissions of the same code snapshot.',
      tags: ['Executions'],
      headers: userIdHeader,
      params: sessionIdParam,
      response: {
        202: {
          type: 'object',
          description: 'Execution queued successfully',
          properties: {
            execution_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] },
            message: { type: 'string', description: 'Present when a duplicate execution was detected' },
          },
        },
        400: {
          description: 'Session not active or expired',
          ...errorResponse,
        },
        401: {
          description: 'Missing x-user-id header',
          ...errorResponse,
        },
        403: {
          description: 'User does not own this session',
          ...errorResponse,
        },
        404: {
          description: 'Session not found',
          ...errorResponse,
        },
        429: {
          description: 'Rate limit or cooldown exceeded',
          ...errorResponse,
        },
      },
    },
  }, (req, rep) => executionController.run(req, rep));

  // GET /api/v1/executions/:execution_id -- Get execution result
  app.get('/api/v1/executions/:execution_id', {
    schema: {
      description: 'Get the result and lifecycle of a code execution. '
        + 'Output fields (stdout, stderr, exit_code, execution_time_ms, memory_used_kb) '
        + 'are only included when the execution has reached a terminal state (COMPLETED, FAILED, TIMEOUT).',
      tags: ['Executions'],
      params: executionIdParam,
      response: {
        200: {
          type: 'object',
          description: 'Execution details',
          properties: {
            execution_id: { type: 'string', format: 'uuid' },
            session_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] },
            queued_at: { type: 'string', format: 'date-time' },
            started_at: { type: 'string', format: 'date-time', nullable: true },
            completed_at: { type: 'string', format: 'date-time', nullable: true },
            stdout: { type: 'string', description: 'Standard output (terminal states only)' },
            stderr: { type: 'string', description: 'Standard error (terminal states only)' },
            exit_code: { type: 'integer', nullable: true, description: 'Process exit code (terminal states only)' },
            execution_time_ms: { type: 'integer', nullable: true, description: 'Wall-clock execution time in ms' },
            memory_used_kb: { type: 'integer', nullable: true, description: 'Peak memory usage in KB' },
            lifecycle: {
              type: 'array',
              description: 'Status transition log',
              items: {
                type: 'object',
                properties: {
                  fromStatus: { type: 'string', nullable: true, enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] },
                  toStatus: { type: 'string', enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        404: {
          description: 'Execution not found',
          ...errorResponse,
        },
      },
    },
  }, (req, rep) => executionController.getResult(req, rep));

  // GET /api/v1/code-sessions/:session_id/executions -- List session executions
  app.get('/api/v1/code-sessions/:session_id/executions', {
    schema: {
      description: 'List the most recent executions for a code session, ordered by queue time descending.',
      tags: ['Executions'],
      params: sessionIdParam,
      response: {
        200: {
          type: 'object',
          description: 'List of executions for the session',
          properties: {
            executions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  status: { type: 'string', enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'] },
                  executionTimeMs: { type: 'integer', nullable: true },
                  queuedAt: { type: 'string', format: 'date-time' },
                  completedAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
      },
    },
  }, (req, rep) => executionController.listBySession(req, rep));
}
