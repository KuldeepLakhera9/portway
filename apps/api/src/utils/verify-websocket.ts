import 'dotenv/config';
import pg from 'pg';
import Redis from 'ioredis';
import WebSocket from 'ws';
import crypto from 'crypto';
import { signJwt } from './jwt.js';

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const db = new pg.Client({ connectionString: databaseUrl });
const redisClient = new Redis(redisUrl);
const redisPub = new Redis(redisUrl);

async function run() {
  console.log('Starting WebSocket logs verification test...');
  await db.connect();

  const testUserId = crypto.randomUUID();
  const testTeamId = crypto.randomUUID();
  const testProjectId = crypto.randomUUID();
  const testDeploymentId = crypto.randomUUID();

  try {
    // 1. Seed user and team
    await db.query(
      `INSERT INTO users (id, name, email, github_id)
       VALUES ($1, 'WS Tester', $2, '12345678')`,
      [testUserId, `ws-test-${testUserId}@example.com`]
    );
    await db.query(
      `INSERT INTO teams (id, name, slug)
       VALUES ($1, 'WS Test Team', $2)`,
      [testTeamId, `ws-test-team-${testTeamId}`]
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [testTeamId, testUserId]
    );

    // 2. Create project and deployment
    await db.query(
      `INSERT INTO projects (id, team_id, name, slug, github_repo_url)
       VALUES ($1, $2, 'WS Test Project', $3, 'https://github.com/ws-test/repo')`,
      [testProjectId, testTeamId, `ws-project-${testProjectId}`]
    );
    await db.query(
      `INSERT INTO deployments (id, project_id, status)
       VALUES ($1, $2, 'building')`,
      [testDeploymentId, testProjectId]
    );

    // 3. Populate Redis logs list buffer
    const mockBufferedLogs = [
      { line: '[LOG] Container initialized.' },
      { line: '[LOG] Running npm install...' },
    ];
    for (const log of mockBufferedLogs) {
      await redisClient.rpush(`logs:buffer:${testDeploymentId}`, JSON.stringify(log));
    }
    await redisClient.expire(`logs:buffer:${testDeploymentId}`, 60);

    // 4. Generate Auth token
    const token = signJwt({
      userId: testUserId,
      email: `ws-test-${testUserId}@example.com`,
      teamId: testTeamId,
      role: 'owner',
    });

    console.log('✓ Mock records seeded. Opening WebSocket connection...');

    // 5. Open WebSocket connection
    const wsUrl = `ws://localhost:3010/deployments/${testDeploymentId}/logs/stream?token=${token}`;
    const ws = new WebSocket(wsUrl);

    const receivedMessages: string[] = [];
    let buildEndReceived = false;

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        console.log('✓ WebSocket connected!');
        
        // Wait 1 second and publish a live log event
        setTimeout(async () => {
          console.log('Publishing live log event to Redis Pub/Sub...');
          const liveLine = { line: '[LOG] Build completed successfully!' };
          await redisPub.publish(`logs:${testDeploymentId}`, JSON.stringify(liveLine));
          
          // Wait another 1 second and flip status in db to trigger complete end event
          setTimeout(async () => {
            console.log('Updating DB status to ready...');
            await db.query(
              "UPDATE deployments SET status = 'ready' WHERE id = $1",
              [testDeploymentId]
            );
          }, 1000);

        }, 1000);
      });

      ws.on('message', (data) => {
        const msgStr = data.toString();
        receivedMessages.push(msgStr);
        console.log(`Received message: ${msgStr}`);

        try {
          const parsed = JSON.parse(msgStr);
          if (parsed.event === 'end') {
            buildEndReceived = true;
          }
        } catch {
          // ignore parsing error
        }
      });

      ws.on('close', () => {
        console.log('✓ WebSocket connection closed by server.');
        resolve();
      });

      ws.on('error', (err) => {
        reject(err);
      });

      // Timeout safety
      setTimeout(() => {
        reject(new Error('WebSocket verification timed out after 10 seconds.'));
      }, 10000);
    });

    // 6. Assertions
    console.log('\n--- Assertion Report ---');
    console.log(`Total messages received: ${receivedMessages.length}`);
    
    const containsInitialLogs = receivedMessages.some(m => m.includes('Container initialized') || m.includes('npm install'));
    const containsLiveLog = receivedMessages.some(m => m.includes('Build completed successfully'));

    console.log(`Initial buffer check: ${containsInitialLogs ? 'PASS' : 'FAIL'}`);
    console.log(`Live stream check: ${containsLiveLog ? 'PASS' : 'FAIL'}`);
    console.log(`Build completion end event check: ${buildEndReceived ? 'PASS' : 'FAIL'}`);

    if (containsInitialLogs && containsLiveLog && buildEndReceived) {
      console.log('\n🌟 SUCCESS! WebSocket log streaming is fully verified and working! 🌟\n');
    } else {
      throw new Error('Some assertions failed.');
    }

  } catch (err: any) {
    console.error('\n❌ WebSocket Verification Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    // 7. Clean up mock database data and Redis values
    console.log('Cleaning up seeded test records...');
    await db.query('DELETE FROM deployments WHERE id = $1', [testDeploymentId]);
    await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    await db.query('DELETE FROM team_members WHERE team_id = $1', [testTeamId]);
    await db.query('DELETE FROM teams WHERE id = $1', [testTeamId]);
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]);

    await redisClient.del(`logs:buffer:${testDeploymentId}`);
    
    await db.end();
    redisClient.disconnect();
    redisPub.disconnect();
    console.log('Done.');
  }
}

run();
