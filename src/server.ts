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
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type', 'x-user-id', 'x-request-id'],
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
        { name: 'Sessions', description: 'Code session management' },
        { name: 'Executions', description: 'Code execution and results' },
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
