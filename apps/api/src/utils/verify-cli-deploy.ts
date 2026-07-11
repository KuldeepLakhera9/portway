import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import tar from 'tar';
import { signJwt } from './jwt.js';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';
const db = new pg.Client({ connectionString: databaseUrl });

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'portway-admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'portway-admin-pass',
  },
  forcePathStyle: true,
});

async function run() {
  console.log('Starting CLI Direct Deploy E2E integration test...');
  await db.connect();

  const testUserId = crypto.randomUUID();
  const testTeamId = crypto.randomUUID();
  const testProjectId = crypto.randomUUID();
  let testDeploymentId = '';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portway-cli-test-'));
  const tempTarFile = path.join(os.tmpdir(), `portway-cli-test-${Date.now()}.tar.gz`);

  try {
    // 0. Clean up any stale records from previous failed runs
    await db.query("DELETE FROM users WHERE github_id = '99999991'");

    // 1. Create a dummy static folder and files
    fs.writeFileSync(
      path.join(tempDir, 'index.html'),
      '<h1>Hello from CLI Direct Deploy</h1>',
      'utf8'
    );
    console.log(`✓ Temporary project folder created at: ${tempDir}`);

    // 2. Compress the folder contents into a tarball
    await new Promise<void>((resolve, reject) => {
      tar.c(
        {
          gzip: true,
          cwd: tempDir,
          portable: true,
        },
        ['.']
      )
        .pipe(fs.createWriteStream(tempTarFile))
        .on('finish', resolve)
        .on('error', reject);
    });
    console.log(`✓ Tarball archive packaged: ${tempTarFile}`);

    // 3. Seed user, team, and project
    await db.query(
      `INSERT INTO users (id, name, email, github_id)
       VALUES ($1, 'CLI Tester', $2, '99999991')`,
      [testUserId, `cli-test-${testUserId}@example.com`]
    );
    await db.query(
      `INSERT INTO teams (id, name, slug)
       VALUES ($1, 'CLI Test Team', $2)`,
      [testTeamId, `cli-test-team-${testTeamId}`]
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [testTeamId, testUserId]
    );
    await db.query(
      `INSERT INTO projects (id, team_id, name, slug, github_repo_url)
       VALUES ($1, $2, 'CLI Direct Project', $3, 'https://github.com/cli-test/repo')`,
      [testProjectId, testTeamId, `cli-project-${testProjectId}`]
    );

    // 4. Generate Session token
    const token = signJwt({
      userId: testUserId,
      email: `cli-test-${testUserId}@example.com`,
      teamId: testTeamId,
      role: 'owner',
    });

    console.log('✓ Database records seeded. Posting deployment to local server...');

    // 5. POST tarball to deploy direct endpoint
    const tarStream = fs.createReadStream(tempTarFile);
    const tarStats = fs.statSync(tempTarFile);

    const response = await fetch(`http://localhost:3010/deploy/direct?projectId=${testProjectId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': tarStats.size.toString(),
      },
      body: tarStream as any,
      duplex: 'half',
    } as any);

    if (response.status !== 201) {
      const errText = await response.text();
      throw new Error(`Direct deploy upload failed with status ${response.status}: ${errText}`);
    }

    const deployResult = (await response.json()) as any;
    testDeploymentId = deployResult.deploymentId;
    console.log(`✓ Upload accepted! Deployment created with ID: ${testDeploymentId}`);
    console.log('Waiting for container execution & artifact extraction...');

    // 6. Poll deployments state until ready or error
    let attempts = 0;
    const maxAttempts = 30;
    let finalStatus = 'queued';

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const deployCheck = await db.query(
        'SELECT status FROM deployments WHERE id = $1',
        [testDeploymentId]
      );

      if (deployCheck.rowCount > 0) {
        finalStatus = deployCheck.rows[0].status;
        console.log(`- Deployment Status: ${finalStatus} (Attempt ${attempts + 1}/${maxAttempts})`);

        if (finalStatus === 'ready' || finalStatus === 'error') {
          break;
        }
      }
      attempts++;
    }

    if (finalStatus !== 'ready') {
      throw new Error(`Deployment ended in state: ${finalStatus}`);
    }

    console.log('✓ Deployment ready! Verifying dynamic routing proxy serves index.html...');

    // 7. Make request to wildcard routing proxy
    const serveUrl = `http://${testDeploymentId}.localhost:3010/index.html`;
    const proxyRes = await fetch(serveUrl);
    
    if (proxyRes.status !== 200) {
      const bodyText = await proxyRes.text();
      throw new Error(`Proxy lookup failed with status ${proxyRes.status}: ${bodyText}`);
    }

    const htmlContent = await proxyRes.text();
    console.log('Proxy Response Content:');
    console.log(htmlContent);

    if (htmlContent.includes('Hello from CLI Direct Deploy')) {
      console.log('\n🌟 SUCCESS! CLI Direct Deploy E2E flow is fully verified! 🌟\n');
    } else {
      throw new Error('Served HTML content did not match target text.');
    }

  } catch (err: any) {
    console.error('\n❌ CLI Deploy E2E Verification Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up local files and directories...');
    if (fs.existsSync(tempTarFile)) {
      fs.unlinkSync(tempTarFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('Cleaning up database records...');
    if (testDeploymentId) {
      await db.query('DELETE FROM deployments WHERE id = $1', [testDeploymentId]);
    }
    await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    await db.query('DELETE FROM team_members WHERE team_id = $1', [testTeamId]);
    await db.query('DELETE FROM teams WHERE id = $1', [testTeamId]);
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]);

    // Clean up MinIO buckets for this deploymentId
    if (testDeploymentId) {
      console.log('Cleaning S3 files...');
      const buckets = ['portway-artifacts', 'portway-logs', 'portway-sources'];
      for (const bucket of buckets) {
        try {
          const listRes = await s3Client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: bucket === 'portway-sources' ? `sources/${testDeploymentId}` : `${testDeploymentId}`,
          }));
          if (listRes.Contents && listRes.Contents.length > 0) {
            for (const obj of listRes.Contents) {
              if (obj.Key) {
                await s3Client.send(new DeleteObjectCommand({
                  Bucket: bucket,
                  Key: obj.Key,
                }));
              }
            }
          }
        } catch (s3Err) {
          console.error(`Failed to clean MinIO bucket ${bucket}:`, s3Err);
        }
      }
      console.log('S3 cleanup complete.');
    }

    await db.end();
    console.log('Finished.');
  }
}

run();
