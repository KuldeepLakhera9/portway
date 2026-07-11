import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from '../utils/jwt.js';
import { db } from '../db/index.js';

// Extend FastifyRequest type
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string | null;
      teamId: string;
      role: string;
    };
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    let token: string | null = null;

    // 1. Try to extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // 2. Try to extract token from Cookie
    if (!token && request.headers.cookie) {
      const cookies = request.headers.cookie.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      token = cookies['token'] || null;
    }

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'No authentication token provided.' });
    }

    // 3. Differentiate between JWT session token and API Token
    // If it's a CLI/API token, it will look like portway_xxx (or standard non-jwt format).
    // Standard JWTs contain three dot-separated parts.
    if (token.split('.').length === 3) {
      // It's a JWT
      try {
        const decoded = verifyJwt(token);
        request.user = {
          id: decoded.userId,
          email: decoded.email,
          teamId: decoded.teamId,
          role: decoded.role,
        };
        return;
      } catch (err: any) {
        return reply.status(401).send({ error: 'Unauthorized', message: `Invalid session token: ${err.message}` });
      }
    } else {
      // It's an API Token. Look it up in Postgres.
      const query = `
        SELECT t.user_id, t.scopes, m.team_id, m.role, u.email
        FROM api_tokens t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN team_members m ON m.user_id = u.id AND m.role = 'owner'
        WHERE t.token = $1 AND (t.expires_at IS NULL OR t.expires_at > NOW())
      `;
      const result = await db.query(query, [token]);
      
      if (result.rowCount === 0) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired API token.' });
      }

      const row = result.rows[0];
      request.user = {
        id: row.user_id,
        email: row.email,
        teamId: row.team_id,
        role: row.role || 'member',
      };
      return;
    }
  } catch (err: any) {
    request.log.error(err, 'Authentication middleware error');
    return reply.status(500).send({ error: 'InternalServerError', message: 'Auth processing error' });
  }
}
