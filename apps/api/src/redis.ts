import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis.default(redisUrl, {
  maxRetriesPerRequest: null, // Critical for BullMQ or similar queues
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis client error:', err);
});
