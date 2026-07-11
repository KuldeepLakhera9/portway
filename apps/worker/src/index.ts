import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { initStorage, processBuild } from './builder.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

console.log('[Worker] Starting Portway Build Worker...');

async function main() {
  // 1. Ensure MinIO bucket storage is provisioned
  try {
    await initStorage();
  } catch (err) {
    console.error('Failed to initialize MinIO bucket storage:', err);
  }

  // 2. Start the BullMQ Worker
  // Concurrency is set to 1 to honor the single ephemeral build container execution constraint
  const worker = new Worker(
    'build-queue',
    async (job) => {
      const { projectId, deploymentId } = job.data;
      console.log(`[Worker] Picked up build job: ${job.id} (Project: ${projectId}, Deployment: ${deploymentId})`);
      try {
        await processBuild(projectId, deploymentId);
        console.log(`[Worker] Finished build job: ${job.id}`);
      } catch (buildErr) {
        console.error(`[Worker] Build job failed: ${job.id}`, buildErr);
        throw buildErr;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );

  console.log('[Worker] Worker listening for build queue jobs.');

  // Graceful shutdown listener
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Graceful shutdown initiated via ${signal}...`);
    await worker.close();
    redisConnection.disconnect();
    console.log('[Worker] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});
