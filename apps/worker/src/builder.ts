import pg from 'pg';
import Docker from 'dockerode';
import Redis from 'ioredis';
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { decrypt } from './utils/encryption.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import tar from 'tar';

const dbUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const encryptionKey = process.env.ENCRYPTION_KEY || '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

// Database Pool
const pool = new pg.Pool({
  connectionString: dbUrl,
});

// Redis client for logs Pub/Sub
const redis = new Redis(redisUrl);

// Dockerode client
const docker = new Docker();

// S3 / MinIO client
const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'portway-admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'portway-admin-pass',
  },
  forcePathStyle: true,
});

// Ensure S3 Buckets exist on startup
export async function initStorage() {
  const buckets = ['portway-artifacts', 'portway-logs'];
  for (const bucket of buckets) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`Successfully created MinIO S3 bucket: ${bucket}`);
      } catch (createErr) {
        console.error(`Error creating MinIO S3 bucket: ${bucket}`, createErr);
      }
    }
  }
}

export async function processBuild(projectId: string, deploymentId: string) {
  console.log(`[Worker] Starting build for project ${projectId}, deployment ${deploymentId}`);
  
  // 1. Retrieve project settings and owner's github_token
  const query = `
    SELECT p.*, u.github_token
    FROM projects p
    JOIN team_members tm ON tm.team_id = p.team_id
    JOIN users u ON u.id = tm.user_id
    WHERE p.id = $1 AND u.github_token IS NOT NULL
    LIMIT 1
  `;
  
  const res = await pool.query(query, [projectId]);
  if (res.rowCount === 0) {
    throw new Error(`Project ${projectId} not found or user is missing a valid GitHub token.`);
  }

  const project = res.rows[0];
  
  // 2. Decrypt GitHub oauth token
  const decryptedToken = decrypt(project.github_token, encryptionKey);

  // 3. Formulate clone URL
  // Matches https://github.com/owner/repo -> https://x-access-token:<token>@github.com/owner/repo.git
  let cleanRepoUrl = project.github_repo_url;
  if (cleanRepoUrl.endsWith('.git')) {
    cleanRepoUrl = cleanRepoUrl.slice(0, -4);
  }
  const cloneUrl = cleanRepoUrl.replace('https://github.com/', `https://x-access-token:${decryptedToken}@github.com/`) + '.git';

  const installCmd = project.install_command || 'npm install';
  const buildCmd = project.build_command || 'npm run build';
  const outDir = project.output_dir || 'dist';

  let logBuffer = '';
  
  function appendLog(line: string) {
    const formatted = `[${new Date().toISOString()}] ${line}`;
    logBuffer += formatted + '\n';
    redis.publish(`logs:${deploymentId}`, JSON.stringify({ line: formatted }));
    redis.rpush(`logs:buffer:${deploymentId}`, JSON.stringify({ line: formatted }));
    redis.expire(`logs:buffer:${deploymentId}`, 3600); // 1 hour TTL buffer
  }

  // Set deployment state to building
  await pool.query(
    'UPDATE deployments SET status = $1, updated_at = NOW() WHERE id = $2',
    ['building', deploymentId]
  );

  appendLog(`Initiating build execution for project: ${project.name}`);
  appendLog(`Using branch: ${project.branch}`);

  // 4. Construct Shell Build Script
  const buildScript = `
set -e
echo "Cloning repository..."
git clone --depth 1 -b ${project.branch} ${cloneUrl} /workspace
cd /workspace

echo "Executing package installation..."
${installCmd}

echo "Executing production build..."
${buildCmd}

echo "Build successful."
`;

  let container: Docker.Container | null = null;
  let exitCode = -1;

  try {
    // Ensure node:20 image is present
    try {
      await docker.getImage('node:20').inspect();
    } catch (imageErr) {
      appendLog('Image node:20 not found locally. Pulling image from Docker Hub (this may take a moment)...');
      await new Promise<void>((resolve, reject) => {
        docker.pull('node:20', (pullErr: any, stream: any) => {
          if (pullErr) return reject(pullErr);
          docker.modem.followProgress(stream, (followErr: any) => {
            if (followErr) return reject(followErr);
            resolve();
          });
        });
      });
      appendLog('Image node:20 successfully downloaded.');
    }

    // 5. Spawn node build container with CAP limits
    container = await docker.createContainer({
      Image: 'node:20',
      Cmd: ['sh', '-c', buildScript],
      Tty: true, // Plain-text streaming (no docker demux headers)
      HostConfig: {
        Memory: 512 * 1024 * 1024, // 512 MB memory limit
        CpuShares: 512,
      },
    });

    appendLog('Spawning build container container...');
    await container.start();

    // 6. Hook logs and stream
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    await new Promise<void>((resolve, reject) => {
      logStream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const lines = text.split('\r\n');
        for (const line of lines) {
          const cleanLine = line.replace('\n', '').trim();
          if (cleanLine) {
            appendLog(cleanLine);
          }
        }
      });
      logStream.on('end', () => resolve());
      logStream.on('error', (err) => reject(err));
    });

    // 7. Get Container status
    const inspectResult = await container.inspect();
    exitCode = inspectResult.State.ExitCode;
    appendLog(`Container exited with status code: ${exitCode}`);

    if (exitCode !== 0) {
      throw new Error(`Build execution failed with exit code: ${exitCode}`);
    }

    // 8. Capture build output archive folder from container
    appendLog(`Retrieving static build assets from: /workspace/${outDir}`);
    const archiveStream = await container.getArchive({
      path: `/workspace/${outDir}`,
    });

    // 9. Extract and upload files individually to MinIO
    appendLog('Extracting and uploading static assets to MinIO S3...');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portway-build-'));
    
    try {
      await new Promise<void>((resolve, reject) => {
        archiveStream.pipe(tar.x({ cwd: tmpDir }))
          .on('error', reject)
          .on('finish', resolve);
      });

      const extractedOutDir = path.join(tmpDir, outDir);
      if (!fs.existsSync(extractedOutDir)) {
        throw new Error(`Expected output directory not found after extraction: ${extractedOutDir}`);
      }

      const uploadDirectory = async (localPath: string, s3Prefix: string) => {
        const entries = fs.readdirSync(localPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullLocalPath = path.join(localPath, entry.name);
          const currentS3Key = `${s3Prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await uploadDirectory(fullLocalPath, currentS3Key);
          } else {
            const fileContent = fs.readFileSync(fullLocalPath);
            const contentType = getMimeType(entry.name);
            await s3Client.send(new PutObjectCommand({
              Bucket: 'portway-artifacts',
              Key: currentS3Key,
              Body: fileContent,
              ContentType: contentType,
            }));
          }
        }
      };

      await uploadDirectory(extractedOutDir, `deployments/${deploymentId}`);
      appendLog('All static assets successfully uploaded to S3.');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (rmTmpErr) {
        console.error('Failed to remove temp directory:', rmTmpErr);
      }
    }

    // Update status to ready
    const deployUrl = `http://${deploymentId}.portway.localhost:3010`;
    await pool.query(
      'UPDATE deployments SET status = $1, url = $2, updated_at = NOW() WHERE id = $3',
      ['ready', deployUrl, deploymentId]
    );

    appendLog(`Deployment finalized successfully! Available at ${deployUrl}`);

  } catch (err: any) {
    appendLog(`ERROR during build: ${err.message || err}`);
    
    // Update deployment status to error
    await pool.query(
      'UPDATE deployments SET status = $1, updated_at = NOW() WHERE id = $2',
      ['error', deploymentId]
    );
  } finally {
    // 10. Clean up container
    if (container) {
      try {
        appendLog('Cleaning build container environment...');
        await container.remove({ force: true });
      } catch (rmErr) {
        console.error('Failed to clean container:', rmErr);
      }
    }

    // 11. Upload logs file to S3
    try {
      const logsKey = `logs/${deploymentId}.txt`;
      await s3Client.send(new PutObjectCommand({
        Bucket: 'portway-logs',
        Key: logsKey,
        Body: logBuffer,
        ContentType: 'text/plain',
      }));

      const externalMinioUrl = process.env.MINIO_EXTERNAL_URL || 'http://localhost:9000';
      const logUrl = `${externalMinioUrl}/portway-logs/${logsKey}`;

      await pool.query(
        `INSERT INTO build_logs_metadata (deployment_id, log_url)
         VALUES ($1, $2)
         ON CONFLICT (deployment_id) DO UPDATE SET log_url = $2`,
        [deploymentId, logUrl]
      );
      // Clean up temporary Redis logs buffer
      await redis.del(`logs:buffer:${deploymentId}`);
    } catch (logS3Err) {
      console.error('Failed to upload build logs to S3:', logS3Err);
    }
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}
