import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(16).default('change-me-in-production-min-16-chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(30),

  EXEC_TIMEOUT_MS: z.coerce.number().default(10000),
  EXEC_MAX_MEMORY_KB: z.coerce.number().default(262144),
  EXEC_MAX_OUTPUT_BYTES: z.coerce.number().default(1048576),
  EXEC_MAX_RETRIES: z.coerce.number().default(2),
  EXEC_MAX_PIDS: z.coerce.number().default(10),

  RATE_LIMIT_EXECUTIONS_PER_MINUTE: z.coerce.number().default(10),
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(200),
  RATE_LIMIT_COOLDOWN_AFTER_TIMEOUTS: z.coerce.number().default(3),
  RATE_LIMIT_COOLDOWN_SECONDS: z.coerce.number().default(60),

  SESSION_MAX_CODE_SIZE_BYTES: z.coerce.number().default(51200),
  SESSION_TTL_HOURS: z.coerce.number().default(4),
  SESSION_MAX_SNAPSHOTS: z.coerce.number().default(50),

  QUEUE_NAME: z.string().default('code-execution'),
  QUEUE_JOB_TTL_MS: z.coerce.number().default(300000),
  QUEUE_CONCURRENCY: z.coerce.number().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
