import { FastifyRequest, FastifyReply } from 'fastify';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'portway-admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'portway-admin-pass',
  },
  forcePathStyle: true,
});

export async function serveDeploymentFile(deploymentId: string, request: FastifyRequest, reply: FastifyReply) {
  // 1. Resolve request file path (normalize and handle index.html redirects)
  let requestPath = request.url.split('?')[0];
  if (requestPath.endsWith('/')) {
    requestPath += 'index.html';
  }
  if (requestPath.startsWith('/')) {
    requestPath = requestPath.slice(1);
  }

  const s3Key = `deployments/${deploymentId}/${requestPath}`;

  try {
    // 2. Fetch asset stream from MinIO S3
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: 'portway-artifacts',
      Key: s3Key,
    }));

    if (!response.Body) {
      return reply.status(404).type('text/html').send('<h1>404 Not Found</h1><p>Empty response body from storage.</p>');
    }

    // 3. Detect and set the Content-Type header
    const contentType = response.ContentType || getMimeType(requestPath);
    reply.header('Content-Type', contentType);

    // 4. Stream response body directly to the client
    return reply.send(response.Body);

  } catch (err: any) {
    if (err.name === 'NoSuchKey') {
      // Return a clean 404 HTML page
      return reply.status(404).type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>404 Not Found</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc; }
            h1 { font-size: 40px; margin-bottom: 8px; color: #ef4444; }
            p { font-size: 18px; color: #94a3b8; }
            hr { border: 0; border-top: 1px solid #334155; margin: 30px auto; max-width: 400px; }
            span { font-size: 12px; color: #64748b; }
          </style>
        </head>
        <body>
          <h1>404 Not Found</h1>
          <p>The requested resource <code>/${requestPath}</code> does not exist on this deployment.</p>
          <hr>
          <span>Portway Edge Routing Proxy</span>
        </body>
        </html>
      `);
    }

    request.log.error(err, `Error retrieving S3 file: ${s3Key}`);
    return reply.status(500).type('text/html').send('<h1>500 Internal Server Error</h1><p>Failed to retrieve deployment files.</p>');
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
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}
