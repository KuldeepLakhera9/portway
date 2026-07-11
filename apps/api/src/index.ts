import 'dotenv/config';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { db } from './db/index.js';
import { redis } from './redis.js';


const PORT = parseInt(process.env.PORT || '3010', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // 1. Run migrations
  try {
    await migrate();
  } catch (error) {
    console.error('Failed to run database migrations:', error);
    process.exit(1);
  }

  // 2. Connect dependencies
  try {
    await redis.connect();
    console.log('Redis connected successfully.');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }

  // 3. Build Fastify application
  const app = await buildApp();

  // 4. Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Graceful shutdown initiated...');
    
    // Close Fastify (drains active requests)
    try {
      await app.close();
      app.log.info('Fastify HTTP server stopped.');
    } catch (err) {
      app.log.error({ err }, 'Error closing Fastify server');
    }

    // Close Database Connections
    try {
      await db.close();
      app.log.info('Database pool closed.');
    } catch (err) {
      app.log.error({ err }, 'Error closing Database pool');
    }

    // Close Redis
    try {
      await redis.quit();
      app.log.info('Redis connection closed.');
    } catch (err) {
      app.log.error({ err }, 'Error closing Redis connection');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 5. Start Server
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Portway API started listening on http://${HOST}:${PORT}`);
    app.log.info(`API documentation available at http://${HOST}:${PORT}/docs`);
  } catch (error) {
    app.log.fatal({ error }, 'Failed to start API control plane');
    process.exit(1);
  }
}

main();
