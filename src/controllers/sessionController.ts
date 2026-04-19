import { FastifyRequest, FastifyReply } from 'fastify';
import { sessionService } from '../services';
import {
  createSessionSchema,
  updateSessionSchema,
  sessionParamsSchema,
  listSessionsQuerySchema,
} from '../types/schemas';
import { getCurrentUserId } from '../middlewares/authGuard';

export class SessionController {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = createSessionSchema.parse(request.body);
    const userId = getCurrentUserId(request);
    const result = await sessionService.create(body, userId);
    return reply.status(201).send(result);
  }

  async autosave(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const body = updateSessionSchema.parse(request.body);
    const userId = getCurrentUserId(request);
    const result = await sessionService.autosave(session_id, body, userId);
    return reply.send(result);
  }

  async getById(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const session = await sessionService.getById(session_id);

    return reply.send({
      session_id: session.id,
      simulation_id: session.simulationId,
      user_id: session.userId,
      title: session.title,
      mode: session.mode,
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

  async list(request: FastifyRequest, reply: FastifyReply) {
    const userId = getCurrentUserId(request);
    const query = listSessionsQuerySchema.parse(request.query);
    const result = await sessionService.listByUser(userId, query);
    return reply.send(result);
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const userId = getCurrentUserId(request);
    const result = await sessionService.delete(session_id, userId);
    return reply.send(result);
  }

  async autosaveEndpoint(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const body = updateSessionSchema.parse(request.body);
    const userId = getCurrentUserId(request);
    const result = await sessionService.autosave(session_id, body, userId);
    return reply.send(result);
  }
}

export const sessionController = new SessionController();
