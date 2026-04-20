import { execSync } from 'child_process';
import crypto from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config, prisma, redis } from './config';
import { registerRoutes } from './routes';
import { errorHandler } from './middlewares/errorHandler';

async function repairLegacyCodeSessionUsers() {
  try {
    const recovered = await prisma.$executeRawUnsafe(`
      INSERT INTO users (id, display_name, is_anonymous, created_at, updated_at)
      SELECT DISTINCT cs.user_id, 'Recovered User', TRUE, NOW(), NOW()
      FROM code_sessions cs
      LEFT JOIN users u ON u.id = cs.user_id
      WHERE u.id IS NULL
    `);

    if (Number(recovered) > 0) {
      console.log(`Recovered ${recovered} missing user records before schema sync`);
    }
  } catch (err: any) {
    // Fresh DB: code_sessions / users tables may not exist yet. Safe to skip.
    if (/does not exist/i.test(String(err?.message ?? err))) return;
    throw err;
  }
}

function runDbPush() {
  // Capture stderr so we can match it; still forward to parent console.
  execSync('npx prisma db push --accept-data-loss', {
    stdio: ['ignore', 'inherit', 'pipe'],
    cwd: process.cwd(),
  });
}

async function syncDatabaseSchema() {
  console.log('Running database migrations...');

  // Proactively repair orphaned code_sessions rows BEFORE db push, so the FK
  // revalidation step in `prisma db push` never sees dangling user_ids.
  try {
    await prisma.$connect();
    await repairLegacyCodeSessionUsers();
  } catch (err) {
    console.warn('Pre-sync repair skipped:', err);
  }

  try {
    runDbPush();
    console.log('Database schema synced successfully');
  } catch (error: any) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    if (stderr) process.stderr.write(stderr);

    const errorText = [stderr, error?.stdout, error?.message].filter(Boolean).join('\n');
    if (/code_sessions_user_id_fkey/.test(errorText)) {
      console.warn('FK violation after repair; running repair once more and retrying...');
      await repairLegacyCodeSessionUsers();
      runDbPush();
      console.log('Database schema synced successfully after repair');
      return;
    }

    throw error;
  }
}

async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    bodyLimit: 1048576,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Security Plugins

  await app.register(cors, {
    origin: config.NODE_ENV === 'production'
      ? ['https://edtronaut.ai', 'https://job-simulations.edtronaut.ai']
      : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-request-id'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production',
  });

  // OpenAPI / Swagger Documentation
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Live Code Execution API',
        description: 'Secure live code execution backend for the Edtronaut Job Simulation Platform. '
          + 'Provides session management, code autosave, and sandboxed execution.',
        version: '1.0.0',
      },
      servers: [
        { url: `http://localhost:${config.PORT}`, description: 'Local development' },
      ],
      tags: [
        { name: 'Health', description: 'Health check endpoint' },
        { name: 'Auth', description: 'Authentication' },
        { name: 'Settings', description: 'User settings' },
        { name: 'Language Packs', description: 'Language pack management' },
        { name: 'Lesson Packs', description: 'Lesson pack management' },
        { name: 'Progress', description: 'Learning progress tracking' },
        { name: 'Sessions', description: 'Code session management' },
        { name: 'Executions', description: 'Code execution and results' },
        { name: 'Submissions', description: 'Lesson submissions and grading' },
        { name: 'Tests', description: 'Test case evaluation' },
        { name: 'Content', description: 'Content delivery' },
        { name: 'Admin', description: 'Admin endpoints' },
        { name: 'System', description: 'System operations' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Rate limit — in-memory store (use Redis store in production with multiple API instances)
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_REQUESTS_PER_MINUTE,
    timeWindow: '1 minute',
  });

  // Global Error Handler
  app.setErrorHandler(errorHandler);

  // Request Logging Hook
  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime },
      'request completed'
    );
    done();
  });

  // Routes
  await registerRoutes(app);

  return app;
}

async function start() {
  try {
    // Run migrations before anything else
    try {
      await syncDatabaseSchema();
    } catch (migrationErr) {
      console.error('Migration failed:', migrationErr);
      // Don't exit — maybe tables already exist
    }

    const app = await buildApp();

    // Verify database connection
    await prisma.$connect();
    console.log('Database connected');

    // Verify Redis connection
    try {
      await redis.ping();
      console.log('Redis connected');
    } catch (err) {
      console.warn('Redis not available, rate limiting will use in-memory store');
    }

    // Start server
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Server running at http://${config.HOST}:${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down server...');
      await app.close();
      await prisma.$disconnect();
      try { await redis.quit(); } catch {}
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

export { buildApp };

// Only start the server when this file is run directly (not imported)
const isMainModule = require.main === module || process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMainModule) {
  start();
}
