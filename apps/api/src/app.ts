import Fastify, { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { tokenRoutes } from './routes/tokens.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    },
    disableRequestLogging: false,
  });

  // Enable CORS
  await app.register(cors, {
    origin: '*',
  });

  // Register Swagger/OpenAPI Spec Generator
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Portway API',
        description: 'Portway Control Plane REST API',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3010',
          description: 'Development Server',
        },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Register Swagger UI
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Register health routes
  await app.register(healthRoutes);

  // Register feature routes
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(tokenRoutes);

  // Global Error Handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, reqId: request.id }, 'Unhandled request error');
    reply.status(error.statusCode || 500).send({
      error: error.name || 'InternalServerError',
      message: error.message || 'An unexpected error occurred.',
      statusCode: error.statusCode || 500,
    });
  });

  return app;
}
