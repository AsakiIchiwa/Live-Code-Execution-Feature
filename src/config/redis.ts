import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from './env';

export const redisConnection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

export const redis = new IORedis({
  ...redisConnection,
  maxRetriesPerRequest: 3,
});

export const executionQueue = new Queue(config.QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
    attempts: config.EXEC_MAX_RETRIES + 1,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

redis.on('error', (err) => console.error('Redis connection error:', err));
redis.on('connect', () => console.log('Redis connected'));
