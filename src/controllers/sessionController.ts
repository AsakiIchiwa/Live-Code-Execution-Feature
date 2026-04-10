import { FastifyRequest, FastifyReply } from 'fastify';
import { sessionService } from '../services';
import {
  createSessionSchema,
  updateSessionSchema,
  sessionParamsSchema,
} from '../types/schemas';
import { AppError } from '../utils/helpers';

export class SessionController {
  /**
   * POST /code-sessions
   */
  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createSessionSchema.parse(request.body);
    const result = await sessionService.create(body);
    return reply.status(201).send(result);
  }

  /**
   * PATCH /code-sessions/:session_id
   */
  async autosave(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const body = updateSessionSchema.parse(request.body);
    const userId = this.extractUserId(request);

    const result = await sessionService.autosave(session_id, body, userId);
    return reply.send(result);
  }

  /**
   * GET /code-sessions/:session_id
   */
  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const session = await sessionService.getById(session_id);

    return reply.send({
      session_id: session.id,
      simulation_id: session.simulationId,
      user_id: session.userId,
      language: session.language.name,
      language_version: session.language.version,
      source_code: session.sourceCode,
      status: session.status,
      version: session.version,
      expires_at: session.expiresAt,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  }

  /**
   * Extract user ID from request header.
   * In production, this would come from JWT/auth middleware.
   */
  extractUserId(request: FastifyRequest): string {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      throw new AppError(401, 'Missing x-user-id header', 'UNAUTHORIZED');
    }
    return userId;
  }
}

export const sessionController = new SessionController();
