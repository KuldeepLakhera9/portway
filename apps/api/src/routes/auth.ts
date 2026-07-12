import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { encrypt } from '../utils/encryption.js';
import { signJwt } from '../utils/jwt.js';
import { authenticate } from '../middleware/auth.js';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || 'http://localhost:3010/auth/github/callback';

export async function authRoutes(app: FastifyInstance) {
  
  // Initiate GitHub OAuth Login redirect
  app.get('/auth/github', {
    schema: {
      description: 'Redirects to GitHub OAuth login page',
      tags: ['Authentication'],
    },
  }, async (request, reply) => {
    if (!GITHUB_CLIENT_ID) {
      request.log.error('GITHUB_CLIENT_ID is not configured');
      return reply.status(500).send({ error: 'ConfigurationError', message: 'GitHub OAuth is not configured on this server.' });
    }

    const host = request.headers.host || '';
    const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
    const callbackUrl = isLocalHost
      ? GITHUB_CALLBACK_URL
      : 'https://api.kuldeeplakhera.me/auth/github/callback';

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user,user:email,repo,admin:repo_hook`;
    
    return reply.redirect(githubAuthUrl);
  });

  // OAuth Authorization Callback
  app.get('/auth/github/callback', {
    schema: {
      description: 'GitHub OAuth callback handler',
      tags: ['Authentication'],
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['code'],
      },
    },
  }, async (request, reply) => {
    const { code, error } = request.query as { code: string; error?: string };

    if (error) {
      request.log.error({ error }, 'GitHub OAuth error parameter received');
      return reply.status(400).send({ error: 'OAuthError', message: `GitHub OAuth failed: ${error}` });
    }

    try {
      // 1. Exchange OAuth code for Access Token
      const host = request.headers.host || '';
      const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
      const callbackUrl = isLocalHost
        ? GITHUB_CALLBACK_URL
        : 'https://api.kuldeeplakhera.me/auth/github/callback';

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callbackUrl,
        }),
      });

      const tokenData = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };

      if (!tokenData.access_token) {
        request.log.error({ tokenData }, 'Failed to exchange OAuth code for access token');
        return reply.status(400).send({
          error: 'OAuthError',
          message: tokenData.error_description || 'Failed to retrieve access token from GitHub.',
        });
      }

      const githubAccessToken = tokenData.access_token;

      // 2. Fetch user profile from GitHub
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${githubAccessToken}`,
          'User-Agent': 'portway-control-plane',
        },
      });

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user profile: [${userResponse.status}] ${userResponse.statusText}`);
      }

      const userData = await userResponse.json() as { id: number; login: string; name: string | null; email: string | null; avatar_url: string };

      // 3. Fetch user email (if not public on profile)
      let email = userData.email;
      if (!email) {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${githubAccessToken}`,
            'User-Agent': 'portway-control-plane',
          },
        });
        if (emailsResponse.ok) {
          const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
          const primaryEmail = emails.find(e => e.primary && e.verified) || emails[0];
          if (primaryEmail) {
            email = primaryEmail.email;
          }
        }
      }

      // Encrypt github token before storing
      const encryptedToken = encrypt(githubAccessToken);

      // 4. Save User & create/get default Personal Team in Postgres (Transaction)
      const pgClient = await db.getPool().connect();
      let userId: string;
      let teamId: string;

      try {
        await pgClient.query('BEGIN');

        // Upsert user
        const userUpsertQuery = `
          INSERT INTO users (github_id, github_token, email, name, avatar_url, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (github_id) 
          DO UPDATE SET github_token = $2, email = $3, name = $4, avatar_url = $5, updated_at = NOW()
          RETURNING id
        `;
        const userResult = await pgClient.query(userUpsertQuery, [
          String(userData.id),
          encryptedToken,
          email,
          userData.name || userData.login,
          userData.avatar_url,
        ]);
        userId = userResult.rows[0].id;

        // Check if user already owns a personal team
        const teamCheckQuery = `
          SELECT t.id 
          FROM teams t
          JOIN team_members tm ON tm.team_id = t.id
          WHERE tm.user_id = $1 AND tm.role = 'owner'
          LIMIT 1
        `;
        const teamCheckResult = await pgClient.query(teamCheckQuery, [userId]);

        if (teamCheckResult.rowCount > 0) {
          teamId = teamCheckResult.rows[0].id;
        } else {
          // Create a new team
          const teamName = `${userData.name || userData.login}'s Personal Team`;
          const teamSlug = `${userData.login.toLowerCase()}-personal`;
          
          const teamInsertQuery = `
            INSERT INTO teams (name, slug)
            VALUES ($1, $2)
            ON CONFLICT (slug)
            DO UPDATE SET name = $1 -- Fail-safe handle name changes
            RETURNING id
          `;
          const teamResult = await pgClient.query(teamInsertQuery, [teamName, teamSlug]);
          teamId = teamResult.rows[0].id;

          // Join as Owner
          const memberInsertQuery = `
            INSERT INTO team_members (team_id, user_id, role)
            VALUES ($1, $2, 'owner')
            ON CONFLICT (team_id, user_id) DO NOTHING
          `;
          await pgClient.query(memberInsertQuery, [teamId, userId]);
        }

        await pgClient.query('COMMIT');
      } catch (txnError) {
        await pgClient.query('ROLLBACK');
        throw txnError;
      } finally {
        pgClient.release();
      }

      // 5. Generate session JWT
      const sessionJwt = signJwt({
        userId,
        email,
        teamId,
        role: 'owner',
      });

      // 6. Set httpOnly Cookie and redirect to dashboard
      reply.header(
        'Set-Cookie',
        `token=${sessionJwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
      );

      const dashboardUrl = isLocalHost 
        ? (process.env.DASHBOARD_URL || 'http://localhost:3000') 
        : 'https://portway.kuldeeplakhera.me';
      return reply.redirect(`${dashboardUrl}/auth/callback?token=${sessionJwt}`);

    } catch (err: any) {
      request.log.error(err, 'Authentication callback failed');
      return reply.status(500).send({ error: 'InternalServerError', message: err.message || 'Authentication processing failed.' });
    }
  });

  // Get current user profile (Authenticated)
  app.get('/auth/me', {
    preHandler: authenticate,
    schema: {
      description: 'Get details of the currently logged-in user',
      tags: ['Authentication'],
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string', nullable: true },
                name: { type: 'string', nullable: true },
                avatarUrl: { type: 'string', nullable: true },
                teamId: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userRes = await db.query(
      'SELECT id, name, email, avatar_url FROM users WHERE id = $1',
      [request.user!.id]
    );

    if (userRes.rowCount === 0) {
      return reply.status(404).send({ error: 'NotFoundError', message: 'User not found.' });
    }

    const dbUser = userRes.rows[0];

    return reply.status(200).send({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name || 'Developer',
        avatarUrl: dbUser.avatar_url,
        teamId: request.user!.teamId,
        role: request.user!.role,
      },
    });
  });
}
