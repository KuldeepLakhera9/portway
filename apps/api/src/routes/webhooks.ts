import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { buildQueue } from '../utils/queue.js';

export async function webhookRoutes(app: FastifyInstance) {
  
  app.post('/webhooks/github', {
    schema: {
      description: 'GitHub push and PR webhook handler',
      tags: ['Webhooks'],
    },
  }, async (request, reply) => {
    const payload = request.body as any;
    
    // We only process push events for now
    const githubEvent = request.headers['x-github-event'];
    if (githubEvent !== 'push') {
      return reply.status(200).send({ message: `Ignored event: ${githubEvent}` });
    }

    if (!payload || !payload.repository) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Malformed payload' });
    }

    // 1. Resolve project by GitHub repository URL
    const repoUrl = payload.repository.html_url;
    
    // Query projects matching the repository URL
    const projectResult = await db.query(
      'SELECT id, webhook_secret, branch FROM projects WHERE github_repo_url = $1 LIMIT 1',
      [repoUrl]
    );

    if (projectResult.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Project not found for this repository.' });
    }

    const project = projectResult.rows[0];

    // 2. Verify webhook signature (HMAC SHA-256)
    const gitHubSignature = request.headers['x-hub-signature-256'] as string;
    if (!gitHubSignature) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing signature header' });
    }

    if (!project.webhook_secret) {
      return reply.status(500).send({ error: 'ConfigurationError', message: 'Webhook secret is not configured on this project.' });
    }

    const hmac = crypto.createHmac('sha256', project.webhook_secret);
    const digest = 'sha256=' + hmac.update(request.rawBody || '').digest('hex');


    try {
      if (!crypto.timingSafeEqual(Buffer.from(gitHubSignature), Buffer.from(digest))) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid signature check failed.' });
      }
    } catch (sigErr) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Signature verification error.' });
    }

    // 3. Verify Branch matches
    // payload.ref is e.g. refs/heads/main
    const branchRef = `refs/heads/${project.branch}`;
    if (payload.ref !== branchRef) {
      return reply.status(200).send({
        message: `Ignored push to branch ${payload.ref}. Expected: ${branchRef}`,
      });
    }

    // 4. Retrieve commit information
    const commitSha = payload.after;
    const headCommit = payload.head_commit || {};
    const commitMessage = headCommit.message || 'Auto-deployment';
    const commitAuthor = headCommit.author?.username || headCommit.author?.name || 'github-webhook';

    try {
      // 5. Create Deployment record (Transaction)
      const deployResult = await db.query(
        `INSERT INTO deployments (project_id, status, commit_sha, commit_message, commit_author, environment)
         VALUES ($1, 'queued', $2, $3, $4, 'production')
         RETURNING id`,
        [project.id, commitSha, commitMessage, commitAuthor]
      );
      
      const deploymentId = deployResult.rows[0].id;

      // 6. Queue the Build job via BullMQ
      await buildQueue.add('build', {
        projectId: project.id,
        deploymentId,
      });

      request.log.info({ projectId: project.id, deploymentId }, 'Build job successfully queued.');

      return reply.status(201).send({
        message: 'Deployment triggered successfully.',
        deploymentId,
      });

    } catch (err: any) {
      request.log.error(err, 'Failed to trigger deployment from webhook');
      return reply.status(500).send({ error: 'InternalServerError', message: 'Failed to queue build.' });
    }
  });
}
