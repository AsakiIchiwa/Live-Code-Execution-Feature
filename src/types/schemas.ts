import { z } from 'zod';

// Code Session Schemas

export const createSessionSchema = z.object({
  simulation_id: z.string().uuid(),
  user_id: z.string().uuid(),
  language: z.string().min(1).max(20),
  template_code: z.string().max(51200).default(''),
});

export const updateSessionSchema = z.object({
  source_code: z.string().max(51200),
  version: z.number().int().positive(),
});

export const runCodeSchema = z.object({
  user_id: z.string().uuid(),
});

// Param Schemas

export const sessionParamsSchema = z.object({
  session_id: z.string().uuid(),
});

export const executionParamsSchema = z.object({
  execution_id: z.string().uuid(),
});

// Types derived from schemas

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type RunCodeInput = z.infer<typeof runCodeSchema>;
