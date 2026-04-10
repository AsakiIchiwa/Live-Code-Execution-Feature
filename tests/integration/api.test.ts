import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'bullmq';
import { buildApp } from '../../src/server';
import { processJob, startWorker } from '../../src/workers/executionWorker';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for Live Code Execution API.
 *
 * Uses Fastify's .inject() for in-process testing — no running server required.
 * Starts an inline BullMQ worker to process execution jobs during tests.
 *
 * Prerequisites: PostgreSQL and Redis must be reachable
 *   docker compose up postgres redis -d
 *
 * Run: npm test
 */

const TEST_USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEST_SIMULATION_ID = '550e8400-e29b-41d4-a716-446655440000';

let app: FastifyInstance;
let worker: Worker;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  // Start an inline worker to process execution jobs
  worker = startWorker();
  // Wait for worker to be ready
  await new Promise<void>((resolve) => {
    worker.on('ready', () => resolve());
  });
});

afterAll(async () => {
  await worker.close();
  await app.close();
});

// Helper to make requests via Fastify inject
async function api(method: string, path: string, body?: object, headers?: Record<string, string>) {
  const reqHeaders: Record<string, string> = { ...headers };

  // Only set content-type when there's a body to send
  if (body !== undefined) {
    reqHeaders['content-type'] = 'application/json';
  }

  const res = await app.inject({
    method: method as any,
    url: path,
    payload: body,
    headers: reqHeaders,
  });

  return { status: res.statusCode, data: res.json() };
}

/**
 * Poll execution status until it reaches a terminal state.
 */
async function pollExecution(executionId: string, maxSeconds = 15): Promise<any> {
  for (let i = 0; i < maxSeconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data } = await api('GET', `/api/v1/executions/${executionId}`);
    if (['COMPLETED', 'FAILED', 'TIMEOUT'].includes(data.status)) {
      return data;
    }
  }
  return undefined;
}

describe('Health Check', () => {
  it('GET /health should return ok', async () => {
    const { status, data } = await api('GET', '/health');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data).toHaveProperty('uptime');
  });
});

describe('Code Sessions API', () => {
  let sessionId: string;

  describe('POST /api/v1/code-sessions', () => {
    it('should create a new session with valid input', async () => {
      const { status, data } = await api('POST', '/api/v1/code-sessions', {
        simulation_id: TEST_SIMULATION_ID,
        user_id: TEST_USER_ID,
        language: 'python',
        template_code: '# Write your solution\n',
      });

      expect(status).toBe(201);
      expect(data.session_id).toBeDefined();
      expect(data.status).toBe('ACTIVE');
      expect(data.language).toBe('python');
      expect(data.expires_at).toBeDefined();
      sessionId = data.session_id;
    });

    it('should reject unsupported language', async () => {
      const { status, data } = await api('POST', '/api/v1/code-sessions', {
        simulation_id: TEST_SIMULATION_ID,
        user_id: TEST_USER_ID,
        language: 'brainfuck',
      });

      expect(status).toBe(400);
      expect(data.error).toBe('INVALID_LANGUAGE');
    });

    it('should reject invalid UUID', async () => {
      const { status, data } = await api('POST', '/api/v1/code-sessions', {
        simulation_id: 'not-a-uuid',
        user_id: TEST_USER_ID,
        language: 'python',
      });

      expect(status).toBe(400);
      expect(data.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/v1/code-sessions/:session_id', () => {
    it('should autosave code with correct version', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/code-sessions/${sessionId}`,
        { source_code: 'print("Hello World")', version: 1 },
        { 'x-user-id': TEST_USER_ID }
      );

      expect(status).toBe(200);
      expect(data.session_id).toBe(sessionId);
      expect(data.version).toBe(2);
    });

    it('should reject stale version (optimistic locking)', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/code-sessions/${sessionId}`,
        { source_code: 'print("stale")', version: 1 }, // version 1 is stale, current is 2
        { 'x-user-id': TEST_USER_ID }
      );

      expect(status).toBe(409);
      expect(data.error).toBe('VERSION_CONFLICT');
    });

    it('should reject request without x-user-id header', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/code-sessions/${sessionId}`,
        { source_code: 'print("no auth")', version: 2 }
      );

      expect(status).toBe(401);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('should reject access from different user', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/code-sessions/${sessionId}`,
        { source_code: 'print("hacked")', version: 2 },
        { 'x-user-id': '770e8400-e29b-41d4-a716-446655440099' }
      );

      expect(status).toBe(403);
      expect(data.error).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/code-sessions/:session_id', () => {
    it('should return session details', async () => {
      const { status, data } = await api('GET', `/api/v1/code-sessions/${sessionId}`);

      expect(status).toBe(200);
      expect(data.session_id).toBe(sessionId);
      expect(data.language).toBe('python');
      expect(data.source_code).toBe('print("Hello World")');
      expect(data.version).toBe(2);
    });

    it('should return 404 for non-existent session', async () => {
      const { status, data } = await api(
        'GET',
        '/api/v1/code-sessions/00000000-0000-0000-0000-000000000000'
      );

      expect(status).toBe(404);
      expect(data.error).toBe('SESSION_NOT_FOUND');
    });
  });
});

describe('Execution API', () => {
  let sessionId: string;
  let executionId: string;

  beforeAll(async () => {
    // Create a session with runnable code
    const { data } = await api('POST', '/api/v1/code-sessions', {
      simulation_id: TEST_SIMULATION_ID,
      user_id: TEST_USER_ID,
      language: 'python',
      template_code: 'print("Hello from test")',
    });
    sessionId = data.session_id;
  });

  describe('POST /api/v1/code-sessions/:session_id/run', () => {
    it('should submit code for execution and return 202', async () => {
      const { status, data } = await api(
        'POST',
        `/api/v1/code-sessions/${sessionId}/run`,
        {},
        { 'x-user-id': TEST_USER_ID }
      );

      expect(status).toBe(202);
      expect(data.execution_id).toBeDefined();
      expect(data.status).toBe('QUEUED');
      executionId = data.execution_id;
    });

    it('should reject run without x-user-id', async () => {
      const { status } = await api(
        'POST',
        `/api/v1/code-sessions/${sessionId}/run`,
        {}
      );

      expect(status).toBe(401);
    });

    it('should reject run from different user', async () => {
      const { status } = await api(
        'POST',
        `/api/v1/code-sessions/${sessionId}/run`,
        {},
        { 'x-user-id': '770e8400-e29b-41d4-a716-446655440099' }
      );

      expect(status).toBe(403);
    });
  });

  describe('GET /api/v1/executions/:execution_id', () => {
    it('should return execution status', async () => {
      const { status, data } = await api('GET', `/api/v1/executions/${executionId}`);

      expect(status).toBe(200);
      expect(data.execution_id).toBe(executionId);
      expect(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT']).toContain(data.status);
      expect(data.lifecycle).toBeDefined();
    });

    it('should return result after execution completes', async () => {
      const result = await pollExecution(executionId);

      expect(result).toBeDefined();
      expect(result.status).toBe('COMPLETED');
      expect(result.stdout).toContain('Hello from test');
      expect(result.execution_time_ms).toBeGreaterThan(0);
    }, 20000);

    it('should return 404 for non-existent execution', async () => {
      const { status, data } = await api(
        'GET',
        '/api/v1/executions/00000000-0000-0000-0000-000000000000'
      );

      expect(status).toBe(404);
      expect(data.error).toBe('EXECUTION_NOT_FOUND');
    });
  });

  describe('GET /api/v1/code-sessions/:session_id/executions', () => {
    it('should list executions for a session', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/code-sessions/${sessionId}/executions`
      );

      expect(status).toBe(200);
      expect(data.executions).toBeInstanceOf(Array);
      expect(data.executions.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('Failure Scenarios', () => {
  let sessionId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/v1/code-sessions', {
      simulation_id: TEST_SIMULATION_ID,
      user_id: TEST_USER_ID,
      language: 'python',
    });
    sessionId = data.session_id;
  });

  it('should handle infinite loop with TIMEOUT', async () => {
    // Save infinite loop code
    await api(
      'PATCH',
      `/api/v1/code-sessions/${sessionId}`,
      { source_code: 'while True: pass', version: 1 },
      { 'x-user-id': TEST_USER_ID }
    );

    // Submit for execution
    const { data: runData } = await api(
      'POST',
      `/api/v1/code-sessions/${sessionId}/run`,
      {},
      { 'x-user-id': TEST_USER_ID }
    );

    const result = await pollExecution(runData.execution_id, 20);

    expect(result).toBeDefined();
    expect(result.status).toBe('TIMEOUT');
  }, 30000);

  it('should handle runtime error with FAILED', async () => {
    // Create new session for this test
    const { data: newSession } = await api('POST', '/api/v1/code-sessions', {
      simulation_id: TEST_SIMULATION_ID,
      user_id: TEST_USER_ID,
      language: 'python',
      template_code: 'raise Exception("test error")',
    });

    // Submit
    const { data: runData } = await api(
      'POST',
      `/api/v1/code-sessions/${newSession.session_id}/run`,
      {},
      { 'x-user-id': TEST_USER_ID }
    );

    const result = await pollExecution(runData.execution_id);

    expect(result).toBeDefined();
    expect(result.status).toBe('FAILED');
    expect(result.stderr).toContain('Exception');
    expect(result.exit_code).not.toBe(0);
  }, 20000);

  it('should handle excessive output gracefully', async () => {
    const { data: session } = await api('POST', '/api/v1/code-sessions', {
      simulation_id: TEST_SIMULATION_ID,
      user_id: TEST_USER_ID,
      language: 'python',
      template_code: 'print("A" * 2000000)',  // 2MB output
    });

    const { data: runData } = await api(
      'POST',
      `/api/v1/code-sessions/${session.session_id}/run`,
      {},
      { 'x-user-id': TEST_USER_ID }
    );

    const result = await pollExecution(runData.execution_id);

    expect(result).toBeDefined();
    // Output should be truncated, not crash the system
    if (result.stdout && result.stdout.length > 0) {
      expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1048576 + 100); // 1MB + truncation msg
    }
  }, 20000);

  it('should reject request to non-existent session', async () => {
    const { status } = await api(
      'POST',
      '/api/v1/code-sessions/00000000-0000-0000-0000-000000000000/run',
      {},
      { 'x-user-id': TEST_USER_ID }
    );

    expect(status).toBe(404);
  });
});
