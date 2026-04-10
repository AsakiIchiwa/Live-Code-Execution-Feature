import { FastifyRequest, FastifyReply } from 'fastify';
import { executionService } from '../services';
import { sessionParamsSchema, executionParamsSchema } from '../types/schemas';
import { AppError } from '../utils/helpers';

export class ExecutionController {
  /**
   * POST /code-sessions/:session_id/run
   */
  async run(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const userId = this.extractUserId(request);

    const result = await executionService.submitExecution(session_id, userId);
    return reply.status(202).send(result);
  }

  /**
   * GET /executions/:execution_id
   */
  async getResult(request: FastifyRequest, reply: FastifyReply) {
    const { execution_id } = executionParamsSchema.parse(request.params);
    const result = await executionService.getExecution(execution_id);
    return reply.send(result);
  }

  /**
   * GET /code-sessions/:session_id/executions
   */
  async listBySession(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const executions = await executionService.listBySession(session_id);
    return reply.send({ executions });
  }

  extractUserId(request: FastifyRequest): string {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      throw new AppError(401, 'Missing x-user-id header', 'UNAUTHORIZED');
    }
    return userId;
  }
}

export const executionController = new ExecutionController();
