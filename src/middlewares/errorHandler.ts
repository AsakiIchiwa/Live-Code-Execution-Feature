import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Global error handler.
 * Uses name-based checks instead of instanceof to avoid CJS/ESM interop issues
 * where instanceof fails across module boundaries.
 */
export function errorHandler(
  error: any,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  // Zod validation errors → 400
  if (error.name === 'ZodError' || Array.isArray(error.issues)) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: (error.issues || []).map((e: any) => ({
        field: (e.path || []).join('.'),
        message: e.message,
      })),
    });
  }

  // Fastify schema validation errors (from JSON Schema route definitions)
  if (error.code === 'FST_ERR_VALIDATION' && Array.isArray(error.validation)) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: error.validation.map((e: any) => ({
        field: e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : (e.params?.missingProperty ?? ''),
        message: e.message ?? 'Validation failed',
      })),
    });
  }

  // Custom application errors (AppError)
  if (error.name === 'AppError' && typeof error.statusCode === 'number') {
    return reply.status(error.statusCode).send({
      error: error.code ?? 'APP_ERROR',
      message: error.message,
    });
  }

  // Prisma known errors (P2002 = unique constraint, P2025 = not found, etc.)
  if (error.code && typeof error.code === 'string' && error.code.startsWith('P')) {
    request.log.error({ prismaCode: error.code, meta: error.meta }, 'Prisma error');
    return reply.status(500).send({
      error: 'DATABASE_ERROR',
      message: 'A database error occurred',
    });
  }

  // Fastify-level errors (rate limit, payload too large, etc.)
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      error: error.code ?? 'REQUEST_ERROR',
      message: error.message,
    });
  }

  // Unknown errors → 500
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}
