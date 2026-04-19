import { FastifyRequest, FastifyReply } from 'fastify';
import { executionService } from '../services';
import { sessionParamsSchema, executionParamsSchema } from '../types/schemas';
import { getCurrentUserId } from '../middlewares/authGuard';

export class ExecutionController {
  async run(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const userId = getCurrentUserId(request);
    const result = await executionService.submitExecution(session_id, userId);
    return reply.status(202).send(result);
  }

  async getResult(request: FastifyRequest, reply: FastifyReply) {
    const { execution_id } = executionParamsSchema.parse(request.params);
    const result = await executionService.getExecution(execution_id);
    return reply.send(result);
  }

  async listBySession(request: FastifyRequest, reply: FastifyReply) {
    const { session_id } = sessionParamsSchema.parse(request.params);
    const executions = await executionService.listBySession(session_id);
    return reply.send({ executions });
  }
}

export const executionController = new ExecutionController();
