import assert from 'assert';
import { db } from '../db/index.js';
import { signJwt } from './jwt.js';
import { encrypt } from './encryption.js';

async function run() {
  console.log('Starting integration verification tests...');
  
  const testEmail = 'dev-test@portway.app';
  
  // 1. Clean up existing test data
  await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
  await db.query('DELETE FROM teams WHERE slug = $1', ['test-integration-team']);
  
  // 2. Seed a test user, team, and membership
  const userResult = await db.query(
    `INSERT INTO users (name, email, github_id, github_token) 
     VALUES ('Dev Test User', $1, '99999999', $2) 
     RETURNING id`, 
    [testEmail, encrypt('dummy-github-access-token')]
  );
  const userId = userResult.rows[0].id;
  
  const teamResult = await db.query(
    `INSERT INTO teams (name, slug) 
     VALUES ('Test Integration Team', 'test-integration-team') 
     RETURNING id`
  );
  const teamId = teamResult.rows[0].id;
  
  await db.query(
    `INSERT INTO team_members (team_id, user_id, role) 
     VALUES ($1, $2, 'owner')`,
    [teamId, userId]
  );

  // 3. Generate a valid JWT token
  const jwtToken = signJwt({
    userId,
    email: testEmail,
    teamId,
    role: 'owner',
  });

  console.log('JWT Token successfully generated.');

  // 4. Test GET /auth/me
  console.log('Verifying /auth/me ...');
  const authResponse = await fetch('http://localhost:3010/auth/me', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });
  assert.strictEqual(authResponse.status, 200, 'GET /auth/me should return 200');
  const authBody = await authResponse.json() as any;
  assert.strictEqual(authBody.user.id, userId);
  assert.strictEqual(authBody.user.email, testEmail);
  assert.strictEqual(authBody.user.teamId, teamId);
  console.log('✓ /auth/me verified.');

  // 5. Test POST /tokens
  console.log('Verifying POST /tokens (API Token generation) ...');
  const createTokenResponse = await fetch('http://localhost:3010/tokens', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'CLI Deployment Token',
      expiresInDays: 30,
    }),
  });
  assert.strictEqual(createTokenResponse.status, 201, 'POST /tokens should return 201');
  const createTokenBody = await createTokenResponse.json() as any;
  assert.ok(createTokenBody.token.startsWith('portway_'));
  const apiToken = createTokenBody.token;
  const tokenId = createTokenBody.details.id;
  console.log(`✓ POST /tokens verified (Generated: ${apiToken}).`);

  // 6. Test GET /tokens
  console.log('Verifying GET /tokens ...');
  const listTokensResponse = await fetch('http://localhost:3010/tokens', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });
  assert.strictEqual(listTokensResponse.status, 200, 'GET /tokens should return 200');
  const listTokensBody = await listTokensResponse.json() as any;
  assert.ok(listTokensBody.tokens.length >= 1);
  console.log('✓ GET /tokens verified.');

  // 7. Verify authentication using the generated CLI API Token
  console.log('Verifying API Token authorization on /auth/me ...');
  const cliAuthResponse = await fetch('http://localhost:3010/auth/me', {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });
  assert.strictEqual(cliAuthResponse.status, 200, 'Bearer <api_token> authorization on /auth/me should return 200');
  const cliAuthBody = await cliAuthResponse.json() as any;
  assert.strictEqual(cliAuthBody.user.id, userId);
  console.log('✓ API Token authorization verified.');

  // 8. Test DELETE /tokens/:id (Revocation)
  console.log('Verifying DELETE /tokens/:id (Revocation) ...');
  const deleteTokenResponse = await fetch(`http://localhost:3010/tokens/${tokenId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });
  assert.strictEqual(deleteTokenResponse.status, 200, 'DELETE /tokens/:id should return 200');
  console.log('✓ DELETE /tokens/:id verified.');

  // 9. Verify the revoked API Token is now rejected
  console.log('Verifying revoked token is rejected ...');
  const revokedResponse = await fetch('http://localhost:3010/auth/me', {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });
  assert.strictEqual(revokedResponse.status, 401, 'Revoked token should return 401 Unauthorized');
  console.log('✓ Revocation check verified.');

  // 10. Test POST /projects (Create Project record)
  console.log('Verifying POST /projects (Create Project) ...');
  const createProjectResponse = await fetch('http://localhost:3010/projects', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Vite React App',
      githubRepoUrl: 'https://github.com/KuldeepLakhera9/my-vite-project',
      branch: 'main',
      buildCommand: 'npm run build',
      installCommand: 'npm install',
      outputDir: 'dist',
    }),
  });
  assert.strictEqual(createProjectResponse.status, 201, 'POST /projects should return 201');
  const createProjectBody = await createProjectResponse.json() as any;
  assert.strictEqual(createProjectBody.project.name, 'Vite React App');
  assert.strictEqual(createProjectBody.project.slug, 'vite-react-app');
  assert.strictEqual(createProjectBody.project.github_repo_url, 'https://github.com/KuldeepLakhera9/my-vite-project');
  const projectId = createProjectBody.project.id;
  console.log('✓ POST /projects verified.');

  // 11. Test GET /projects (List Projects)
  console.log('Verifying GET /projects ...');
  const listProjectsResponse = await fetch('http://localhost:3010/projects', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });
  assert.strictEqual(listProjectsResponse.status, 200, 'GET /projects should return 200');
  const listProjectsBody = await listProjectsResponse.json() as any;
  assert.ok(listProjectsBody.projects.length >= 1);
  console.log('✓ GET /projects verified.');

  // 12. Test GET /projects/:id (Get Project Details)
  console.log('Verifying GET /projects/:id ...');
  const getProjectResponse = await fetch(`http://localhost:3010/projects/${projectId}`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });
  assert.strictEqual(getProjectResponse.status, 200, 'GET /projects/:id should return 200');
  const getProjectBody = await getProjectResponse.json() as any;
  assert.strictEqual(getProjectBody.project.id, projectId);
  assert.strictEqual(getProjectBody.project.name, 'Vite React App');
  console.log('✓ GET /projects/:id verified.');

  // Cleanup seeded test user
  await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
  await db.close();
  
  console.log('\n🌟 Integration verification completed successfully! All endpoints verified. 🌟');
}

run().catch((err) => {
  console.error('Integration check failed:', err);
  db.close().then(() => process.exit(1));
});
