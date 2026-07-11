import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { decrypt } from '../utils/encryption.js';
import { GitHubClient } from '../utils/github.js';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'http://localhost:3010';

export async function projectRoutes(app: FastifyInstance) {
  
  // List GitHub repositories accessible by the user
  app.get('/projects/github-repos', {
    preHandler: authenticate,
    schema: {
      description: 'List user repositories from GitHub',
      tags: ['Projects'],
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    try {
      // 1. Fetch user's encrypted github token from DB
      const result = await db.query('SELECT github_token FROM users WHERE id = $1', [request.user!.id]);
      if (result.rowCount === 0 || !result.rows[0].github_token) {
        return reply.status(400).send({ error: 'GitHubConnectionError', message: 'No GitHub account connected.' });
      }

      // 2. Decrypt token and fetch repos
      const decryptedToken = decrypt(result.rows[0].github_token);
      const github = new GitHubClient(decryptedToken);
      const repos = await github.getUserRepos();

      // Return a clean list of repos
      const cleanRepos = repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        url: repo.html_url,
        defaultBranch: repo.default_branch,
      }));

      return reply.status(200).send({ repos: cleanRepos });
    } catch (err: any) {
      request.log.error(err, 'Failed to fetch GitHub repos');
      return reply.status(500).send({ error: 'GitHubConnectionError', message: err.message || 'Failed to list GitHub repositories.' });
    }
  });

  // Create a new project (connects a repository)
  app.post('/projects', {
    preHandler: authenticate,
    schema: {
      description: 'Connect a new Git repository and register it as a project',
      tags: ['Projects'],
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'githubRepoUrl'],
        properties: {
          name: { type: 'string', minLength: 2 },
          githubRepoUrl: { type: 'string', pattern: '^https://github.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+' },
          branch: { type: 'string', default: 'main' },
          buildCommand: { type: 'string', nullable: true },
          installCommand: { type: 'string', nullable: true },
          outputDir: { type: 'string', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    const { name, githubRepoUrl, branch, buildCommand, installCommand, outputDir } = request.body as {
      name: string;
      githubRepoUrl: string;
      branch?: string;
      buildCommand?: string | null;
      installCommand?: string | null;
      outputDir?: string | null;
    };

    // Extract owner and repo name from URL
    // e.g. https://github.com/owner/repo
    const repoPath = githubRepoUrl.replace('https://github.com/', '').trim();
    const parts = repoPath.split('/');
    if (parts.length !== 2) {
      return reply.status(400).send({ error: 'ValidationError', message: 'Invalid GitHub repository URL.' });
    }
    const [owner, repo] = parts;

    // Generate project slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if slug is taken within the team
    const slugCheck = await db.query(
      'SELECT id FROM projects WHERE team_id = $1 AND slug = $2',
      [request.user!.teamId, slug]
    );
    if (slugCheck.rowCount > 0) {
      return reply.status(400).send({ error: 'ConflictError', message: 'A project with this name already exists in your team.' });
    }

    try {
      // Fetch user's encrypted github token
      const userResult = await db.query('SELECT github_token FROM users WHERE id = $1', [request.user!.id]);
      if (userResult.rowCount === 0 || !userResult.rows[0].github_token) {
        return reply.status(400).send({ error: 'GitHubConnectionError', message: 'No GitHub account connected.' });
      }
      
      const decryptedToken = decrypt(userResult.rows[0].github_token);
      const github = new GitHubClient(decryptedToken);

      // Generate webhook secret
      const webhookSecret = crypto.randomBytes(20).toString('hex');
      const webhookUrl = `${WEBHOOK_BASE_URL}/webhooks/github`;

      // Register Webhook on GitHub repository
      let githubHookId: string | null = null;
      try {
        const hookResult = await github.createWebhook(owner, repo, webhookUrl, webhookSecret);
        githubHookId = String(hookResult.id);
      } catch (hookErr: any) {
        request.log.warn({ hookErr }, 'Failed to create GitHub webhook; proceeding to create project record anyway.');
      }

      // Save project to Postgres
      const insertQuery = `
        INSERT INTO projects (
          team_id, name, slug, github_repo_url, branch, 
          build_command, install_command, output_dir, webhook_secret, github_repo_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, name, slug, github_repo_url, branch, build_command, install_command, output_dir, created_at
      `;

      const result = await db.query(insertQuery, [
        request.user!.teamId,
        name,
        slug,
        githubRepoUrl,
        branch || 'main',
        buildCommand || null,
        installCommand || null,
        outputDir || null,
        webhookSecret,
        githubHookId,
      ]);

      const project = result.rows[0];

      return reply.status(201).send({
        message: 'Project created successfully.',
        project,
      });

    } catch (err: any) {
      request.log.error(err, 'Failed to create project');
      return reply.status(500).send({ error: 'InternalServerError', message: err.message || 'Failed to create project.' });
    }
  });

  // Get all projects for current team
  app.get('/projects', {
    preHandler: authenticate,
    schema: {
      description: 'List all projects in the current user\'s team',
      tags: ['Projects'],
      security: [{ BearerAuth: [] }],
    },
  }, async (request, reply) => {
    const result = await db.query(
      'SELECT id, name, slug, github_repo_url, branch, build_command, install_command, output_dir, created_at FROM projects WHERE team_id = $1 ORDER BY created_at DESC',
      [request.user!.teamId]
    );

    return reply.status(200).send({ projects: result.rows });
  });

  // Get project by ID
  app.get('/projects/:id', {
    preHandler: authenticate,
    schema: {
      description: 'Get project details by ID',
      tags: ['Projects'],
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

    const result = await db.query(
      'SELECT id, name, slug, github_repo_url, branch, build_command, install_command, output_dir, created_at FROM projects WHERE team_id = $1 AND id = $2',
      [request.user!.teamId, id]
    );

    if (result.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'Project not found.' });
    }

    return reply.status(200).send({ project: result.rows[0] });
  });
}
