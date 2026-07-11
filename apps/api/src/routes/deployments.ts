import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { redis } from '../redis.js';
import { authenticate } from '../middleware/auth.js';
import { verifyJwt } from '../utils/jwt.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'portway-admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'portway-admin-pass',
  },
  forcePathStyle: true,
});

export async function deploymentRoutes(app: FastifyInstance) {

  // Get single deployment details
  app.get('/deployments/:id', {
    preHandler: authenticate,
    schema: {
      description: 'Get details of a deployment',
      tags: ['Deployments'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const query = `
      SELECT d.*, p.name as project_name, p.slug as project_slug
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE d.id = $1 AND tm.user_id = $2
    `;

    const res = await db.query(query, [id, request.user!.id]);
    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Deployment not found.' });
    }

    return res.rows[0];
  });

  // Get full build logs text (historical or buffered)
  app.get('/deployments/:id/logs', {
    preHandler: authenticate,
    schema: {
      description: 'Retrieve full text logs for a deployment',
      tags: ['Deployments'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Validate access
    const checkQuery = `
      SELECT d.status 
      FROM deployments d
      JOIN projects p ON p.id = d.project_id
      JOIN team_members tm ON tm.team_id = p.team_id
      WHERE d.id = $1 AND tm.user_id = $2
    `;
    const checkRes = await db.query(checkQuery, [id, request.user!.id]);
    if (checkRes.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Deployment not found.' });
    }

    const status = checkRes.rows[0].status;

    // If completed, fetch from S3
    if (status === 'ready' || status === 'error') {
      try {
        const s3Res = await s3Client.send(new GetObjectCommand({
          Bucket: 'portway-logs',
          Key: `logs/${id}.txt`,
        }));
        const logContent = await s3Res.Body?.transformToString();
        return { logs: logContent || '' };
      } catch (err: any) {
        request.log.error(err, 'Failed to fetch logs from S3');
        return { logs: 'Logs file not found or could not be loaded.' };
      }
    }

    // If still in progress, return the current Redis buffer
    const bufferLines = await redis.lrange(`logs:buffer:${id}`, 0, -1);
    const logs = bufferLines
      .map((line) => {
        try {
          return JSON.parse(line).line;
        } catch {
          return line;
        }
      })
      .join('\n');

    return { logs };
  });

  // WebSocket route for streaming build logs live
  app.get('/deployments/:id/logs/stream', {
    websocket: true,
  }, async (connection, request) => {
    const deploymentId = (request.params as any).id;
    const token = (request.query as any).token;

    if (!token) {
      connection.socket.send(JSON.stringify({ error: 'Unauthorized', message: 'Missing auth token query parameter.' }));
      connection.socket.close();
      return;
    }

    let userPayload: any;
    try {
      userPayload = verifyJwt(token);
    } catch (err) {
      connection.socket.send(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or expired session token.' }));
      connection.socket.close();
      return;
    }

    // Validate project member access to this deployment
    const memberCheck = await db.query(
      `SELECT d.status 
       FROM deployments d
       JOIN projects p ON p.id = d.project_id
       JOIN team_members tm ON tm.team_id = p.team_id
       WHERE d.id = $1 AND tm.user_id = $2`,
      [deploymentId, userPayload.userId]
    );

    if (memberCheck.rowCount === 0) {
      connection.socket.send(JSON.stringify({ error: 'Unauthorized', message: 'Access denied.' }));
      connection.socket.close();
      return;
    }

    // 1. Send all buffered logs accumulated so far
    const buffer = await redis.lrange(`logs:buffer:${deploymentId}`, 0, -1);
    for (const logLine of buffer) {
      connection.socket.send(logLine);
    }

    const initialStatus = memberCheck.rows[0].status;
    if (initialStatus === 'ready' || initialStatus === 'error') {
      connection.socket.send(JSON.stringify({ event: 'end', status: initialStatus }));
      connection.socket.close();
      return;
    }

    // 2. Establish subscription connection to Redis Pub/Sub
    const subRedis = redis.duplicate();
    try {
      await subRedis.connect();
    } catch (redisErr) {
      request.log.error(redisErr, 'Failed to duplicate Redis client for PubSub');
      connection.socket.close();
      return;
    }

    await subRedis.subscribe(`logs:${deploymentId}`);

    subRedis.on('message', (channel, message) => {
      connection.socket.send(message);
    });

    // 3. Keep polling the DB status changes to close socket when finished
    const statusChecker = setInterval(async () => {
      try {
        const statRes = await db.query('SELECT status FROM deployments WHERE id = $1', [deploymentId]);
        if (statRes.rowCount > 0) {
          const currentStatus = statRes.rows[0].status;
          if (currentStatus === 'ready' || currentStatus === 'error') {
            connection.socket.send(JSON.stringify({ event: 'end', status: currentStatus }));
            clearInterval(statusChecker);
            connection.socket.close();
          }
        }
      } catch (dbErr) {
        request.log.error(dbErr, 'Failed to query status during socket stream');
      }
    }, 2000);

    // Clean up connections on socket exit
    connection.socket.on('close', async () => {
      clearInterval(statusChecker);
      try {
        await subRedis.unsubscribe(`logs:${deploymentId}`);
        subRedis.disconnect();
      } catch (subErr) {
        // ignore disconnect errors
      }
    });
  });
}
