import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { s3Client } from '../utils/s3.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/auth.js';
import { buildQueue } from '../utils/queue.js';
import crypto from 'crypto';

export async function deployRoutes(app: FastifyInstance) {
  // Direct CLI deploy endpoint (application/octet-stream upload)
  app.post('/deploy/direct', {
    preHandler: authenticate,
    schema: {
      description: 'Deploy project directly from local files by uploading a zipped tarball',
      tags: ['Deployments'],
      querystring: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { projectId } = request.query as { projectId: string };

    // 1. Verify project exists and developer belongs to the team
    const checkProject = await db.query(
      `SELECT p.id, p.name 
       FROM projects p
       JOIN team_members tm ON tm.team_id = p.team_id
       WHERE p.id = $1 AND tm.user_id = $2`,
      [projectId, request.user!.id]
    );

    if (checkProject.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Project not found or access denied.' });
    }

    const deploymentId = crypto.randomUUID();
    const s3Key = `sources/${deploymentId}.tar.gz`;

    // 2. Stream the body to S3
    const contentLengthStr = request.headers['content-length'];
    if (!contentLengthStr) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Content-Length header is required.' });
    }
    const contentLength = Number(contentLengthStr);

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: 'portway-sources',
        Key: s3Key,
        Body: request.body as any, // Raw stream parsed by Fastify
        ContentLength: contentLength,
        ContentType: 'application/x-tar',
      }));
    } catch (s3Err: any) {
      request.log.error(s3Err, 'Failed to upload source tarball to S3');
      return reply.status(500).send({ error: 'StorageError', message: 'Failed to upload deployment archive.' });
    }

    // 3. Create deployment database record
    const insertQuery = `
      INSERT INTO deployments (id, project_id, status, source_type, source_key, commit_message, commit_author)
      VALUES ($1, $2, 'queued', 'zip', $3, 'CLI Direct Upload Deploy', $4)
      RETURNING id, status, created_at
    `;
    await db.query(insertQuery, [
      deploymentId,
      projectId,
      s3Key,
      request.user!.name || request.user!.email,
    ]);

    // 4. Trigger build worker via queue
    await buildQueue.add('build', {
      projectId,
      deploymentId,
    });

    const deployUrl = `http://${deploymentId}.portway.localhost:3010/index.html`;

    return reply.status(201).send({
      message: 'Deployment successfully queued.',
      deploymentId,
      url: deployUrl,
    });
  });
}
