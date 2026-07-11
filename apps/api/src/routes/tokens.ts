import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';

export async function tokenRoutes(app: FastifyInstance) {
  
  // Create a new API Token
  app.post('/tokens', {
    preHandler: authenticate,
    schema: {
      description: 'Generate a new revocable API token for CLI / programmatic access',
      tags: ['API Tokens'],
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 100 },
          expiresInDays: { type: 'number', nullable: true }, // Optional expiration time
        },
      },
    },
  }, async (request, reply) => {
    const { name, expiresInDays } = request.body as { name: string; expiresInDays?: number | null };

    // Generate unique API Token (prefixed with portway_ for identification)
    const rawToken = `portway_${crypto.randomBytes(32).toString('hex')}`;

    let expiresAt: Date | null = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    try {
      const insertQuery = `
        INSERT INTO api_tokens (user_id, token, name, expires_at, scopes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, expires_at, created_at
      `;

      const result = await db.query(insertQuery, [
        request.user!.id,
        rawToken,
        name,
        expiresAt,
        JSON.stringify(['*']), // Full access scopes by default
      ]);

      const tokenRecord = result.rows[0];

      return reply.status(201).send({
        message: 'API token generated successfully. Copy this token now as it will not be displayed again.',
        token: rawToken,
        details: tokenRecord,
      });

    } catch (err: any) {
      request.log.error(err, 'Failed to create API token');
      return reply.status(500).send({ error: 'InternalServerError', message: 'Failed to generate token.' });
    }
  });

  // List all API Tokens
  app.get('/tokens', {
    preHandler: authenticate,
    schema: {
      description: 'List active API tokens for the authenticated user',
      tags: ['API Tokens'],
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT id, name, expires_at, created_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC',
        [request.user!.id]
      );
      
      return reply.status(200).send({ tokens: result.rows });
    } catch (err: any) {
      request.log.error(err, 'Failed to list API tokens');
      return reply.status(500).send({ error: 'InternalServerError', message: 'Failed to retrieve tokens.' });
    }
  });

  // Revoke an API Token
  app.delete('/tokens/:id', {
    preHandler: authenticate,
    schema: {
      description: 'Revoke (delete) an API token',
      tags: ['API Tokens'],
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await db.query(
        'DELETE FROM api_tokens WHERE user_id = $1 AND id = $2 RETURNING id',
        [request.user!.id, id]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'NotFoundError', message: 'API token not found.' });
      }

      return reply.status(200).send({ message: 'API token revoked successfully.' });
    } catch (err: any) {
      request.log.error(err, 'Failed to revoke API token');
      return reply.status(500).send({ error: 'InternalServerError', message: 'Failed to revoke token.' });
    }
  });
}
