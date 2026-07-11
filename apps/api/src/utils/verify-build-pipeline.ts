import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';
const encryptionKey = process.env.ENCRYPTION_KEY || '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const db = new pg.Client({
  connectionString: databaseUrl,
});

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'portway-admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'portway-admin-pass',
  },
  forcePathStyle: true,
});

// Simple AES encrypt helper to seed user tokens
function encryptToken(text: string): string {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(encryptionKey, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function run() {
  console.log('Starting build pipeline verification test...');
  await db.connect();

  const testEmail = 'pipeline-test@portway.dev';
  const repoUrl = 'https://github.com/octocat/Spoon-Knife';
  const webhookSecret = 'test-webhook-secret-54321';

  let testUserId = '';
  let testTeamId = '';
  let testProjectId = '';
  let testDeploymentId = '';

  try {
    // 1. Clean up any leftover test data
    console.log('Cleaning up old test data...');
    await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await db.query('DELETE FROM teams WHERE slug = $1', ['pipeline-test-team']);

    // 2. Seed a test user, team, and membership
    console.log('Seeding user and team...');
    const encryptedToken = encryptToken('mock-github-token-12345');
    const userRes = await db.query(
      `INSERT INTO users (name, email, github_token, github_id)
       VALUES ('Pipeline Tester', $1, $2, '999999')
       RETURNING id`,
      [testEmail, encryptedToken]
    );
    testUserId = userRes.rows[0].id;

    const teamRes = await db.query(
      `INSERT INTO teams (name, slug)
       VALUES ('Pipeline Test Team', 'pipeline-test-team')
       RETURNING id`
    );
    testTeamId = teamRes.rows[0].id;

    await db.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [testTeamId, testUserId]
    );

    // 3. Create a Project targeting Spoon-Knife with inline build commands
    console.log('Creating project...');
    const projectRes = await db.query(
      `INSERT INTO projects (team_id, name, slug, github_repo_url, branch, install_command, build_command, output_dir, webhook_secret)
       VALUES ($1, 'Spoon Knife Webhook Test', 'spoon-knife-test', $2, 'main', 'echo "Install cmd run"', $3, 'dist', $4)
       RETURNING id`,
      [
        testTeamId,
        repoUrl,
        'mkdir -p dist && echo "<h1>Hello Portway Build Pipeline</h1>" > dist/index.html',
        webhookSecret
      ]
    );
    testProjectId = projectRes.rows[0].id;

    // 4. Simulate a GitHub push payload
    console.log('Preparing push payload...');
    const payload = {
      ref: 'refs/heads/main',
      after: 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1',
      repository: {
        html_url: repoUrl,
      },
      head_commit: {
        id: 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1',
        message: 'Commit from integration verification pipeline script',
        author: {
          name: 'octocat',
          username: 'octocat'
        }
      }
    };
    
    const payloadString = JSON.stringify(payload);
    
    // 5. Calculate GitHub signature (HMAC SHA256)
    const hmac = crypto.createHmac('sha256', webhookSecret);
    const signature = 'sha256=' + hmac.update(payloadString).digest('hex');

    // 6. Post the webhook to the local running API server
    console.log('Sending webhook to API server...');
    const response = await fetch('http://localhost:3010/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'push',
        'x-hub-signature-256': signature,
      },
      body: payloadString,
    });

    if (response.status !== 201) {
      const errText = await response.text();
      throw new Error(`Webhook dispatch failed with status ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as any;
    testDeploymentId = result.deploymentId;
    console.log(`✓ Webhook accepted. Deployment queued with ID: ${testDeploymentId}`);

    // 7. Poll database for deployment completion
    console.log('Waiting for build container to pull, run, and upload artifacts...');
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max wait
    let finalStatus = 'queued';

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const deployQuery = await db.query(
        'SELECT status, url FROM deployments WHERE id = $1',
        [testDeploymentId]
      );
      
      if (deployQuery.rowCount > 0) {
        finalStatus = deployQuery.rows[0].status;
        console.log(`- Deployment Status: ${finalStatus} (Attempt ${attempts + 1}/${maxAttempts})`);
        if (finalStatus === 'ready' || finalStatus === 'error') {
          break;
        }
      }
      attempts++;
    }

    if (finalStatus !== 'ready') {
      try {
        const s3Log = await s3Client.send(new GetObjectCommand({
          Bucket: 'portway-logs',
          Key: `logs/${testDeploymentId}.txt`,
        }));
        const logContent = await s3Log.Body?.transformToString();
        console.log('\n--- Build Logs on Failure ---');
        console.log(logContent);
        console.log('-----------------------------\n');
      } catch (logErr) {
        console.error('Could not retrieve build logs from S3:', logErr);
      }
      throw new Error(`Build pipeline failed. Deployment ended in state: ${finalStatus}`);
    }

    console.log('✓ Deployment is READY! Verifying routing proxy serving static files...');

    // 8. Make a request to the routing proxy using the subdomain URL
    const serveUrl = `http://${testDeploymentId}.localhost:3010/index.html`;
    const proxyRes = await fetch(serveUrl);

    if (proxyRes.status !== 200) {
      const bodyText = await proxyRes.text();
      throw new Error(`Routing proxy failed to serve index.html with status ${proxyRes.status}: ${bodyText}`);
    }

    const htmlContent = await proxyRes.text();
    console.log('Proxy Response Content:\n', htmlContent);

    if (!htmlContent.includes('Hello Portway Build Pipeline')) {
      throw new Error('Served content did not match expected build HTML output.');
    }

    console.log('🌟 SUCCESS! Ephemeral build succeeded, artifacts uploaded, and served correctly via Routing Proxy! 🌟');

  } catch (err: any) {
    console.error('❌ Verification failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    // 9. Clean up database records
    console.log('Cleaning up database records...');
    if (testUserId) {
      await db.query('DELETE FROM users WHERE email = $1', [testEmail]);
      await db.query('DELETE FROM teams WHERE slug = $1', ['pipeline-test-team']);
    }

    // 10. Clean up S3 assets
    if (testDeploymentId) {
      console.log('Cleaning S3 files...');
      try {
        // List files under prefix deployments/{deploymentId}
        const s3Prefix = `deployments/${testDeploymentId}`;
        const listed = await s3Client.send(new ListObjectsV2Command({
          Bucket: 'portway-artifacts',
          Prefix: s3Prefix,
        }));
        
        if (listed.Contents) {
          for (const item of listed.Contents) {
            if (item.Key) {
              await s3Client.send(new DeleteObjectCommand({
                Bucket: 'portway-artifacts',
                Key: item.Key,
              }));
            }
          }
        }

        // Delete logs
        await s3Client.send(new DeleteObjectCommand({
          Bucket: 'portway-logs',
          Key: `logs/${testDeploymentId}.txt`,
        }));
        console.log('S3 cleanup complete.');
      } catch (s3CleanErr) {
        console.error('Failed to clean S3 objects:', s3CleanErr);
      }
    }

    await db.end();
    console.log('Finished.');
  }
}

run().catch(console.error);
