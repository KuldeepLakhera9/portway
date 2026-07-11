import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { redis } from '../redis.js';

export async function healthRoutes(app: FastifyInstance) {
  // Liveness Check: verifies the process is alive
  app.get('/healthz', {
    schema: {
      description: 'Liveness check endpoint',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  // Readiness Check: verifies all database and cache systems are connected
  app.get('/readyz', {
    schema: {
      description: 'Readiness check endpoint for DB/Cache dependencies',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                postgres: { type: 'string' },
                redis: { type: 'string' },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                postgres: { type: 'string' },
                redis: { type: 'string' },
              },
            },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const services = {
      postgres: 'unknown',
      redis: 'unknown',
    };

    try {
      // 1. Check PostgreSQL
      await db.query('SELECT 1');
      services.postgres = 'healthy';

      // 2. Check Redis
      const redisPing = await redis.ping();
      if (redisPing === 'PONG') {
        services.redis = 'healthy';
      } else {
        services.redis = 'unhealthy';
      }

      if (services.postgres === 'healthy' && services.redis === 'healthy') {
        return reply.status(200).send({
          status: 'ready',
          services,
        });
      } else {
        return reply.status(503).send({
          status: 'unready',
          services,
          error: 'One or more dependencies are unhealthy',
        });
      }
    } catch (err: any) {
      request.log.error({ err }, 'Readiness check failed');
      return reply.status(503).send({
        status: 'unready',
        services,
        error: err.message || 'Readiness validation error',
      });
    }
  });
}
