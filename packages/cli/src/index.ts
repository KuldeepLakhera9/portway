#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import tar from 'tar';
import WebSocket from 'ws';

const program = new Command();
const CONFIG_DIR = path.join(os.homedir(), '.portway');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const API_BASE = process.env.PORTWAY_API_URL || 'http://localhost:3010';
const WS_BASE = process.env.PORTWAY_WS_URL || 'ws://localhost:3010';

// Helper to load session config
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return {};
}

// Helper to write session config
function saveConfig(config: any) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// Command 1: Authenticate / Login
program
  .command('login')
  .description('Authenticate with your Portway API Token')
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Please enter your Portway API Token: ', async (token) => {
      rl.close();
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        console.error('❌ Error: Token cannot be empty.');
        process.exit(1);
      }

      console.log('Verifying token with API control plane...');

      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${trimmedToken}`,
          },
        });

        const data = (await response.json()) as any;
        if (!response.ok) {
          throw new Error(data.message || 'Verification failed.');
        }

        const username = data.user?.name || 'Developer';
        console.log(`\n✓ Success! Welcome back, ${username}. Saved credentials.`);
        saveConfig({ token: trimmedToken });

      } catch (err: any) {
        console.error('\n❌ Invalid Token:', err.message || err);
        process.exit(1);
      }
    });
  });

// Command 2: Direct Deploy Folder
program
  .command('deploy')
  .description('Deploy a static directory directly to Portway')
  .option('-p, --project <projectId>', 'The UUID of the Portway project')
  .option('-d, --dir <directory>', 'Path to the directory containing static build files', '.')
  .action(async (options) => {
    const config = loadConfig();
    const token = config.token;

    if (!token) {
      console.error('❌ Error: You are not logged in. Please run "portway login" first.');
      process.exit(1);
    }

    const { project: projectId, dir: deployDir } = options;
    if (!projectId) {
      console.error('❌ Error: Project ID (--project <projectId>) is required.');
      process.exit(1);
    }

    const absoluteDir = path.resolve(deployDir);
    if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
      console.error(`❌ Error: Directory "${deployDir}" does not exist or is not a folder.`);
      process.exit(1);
    }

    console.log(`Packaging directory content: ${absoluteDir} ...`);
    const tempFile = path.join(os.tmpdir(), `portway-deploy-${Date.now()}.tar.gz`);

    try {
      // 1. Create a gzipped tarball from folder
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(tempFile);
        tar.c({
          gzip: true,
          cwd: absoluteDir,
          portable: true,
        }, ['.'])
        .pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
      });

      const stats = fs.statSync(tempFile);
      console.log(`✓ Packaging complete. Size: ${(stats.size / 1024).toFixed(2)} KB.`);
      console.log('Uploading deployment archive...');

      // 2. Stream tarball upload to API direct deploy endpoint
      const fileStream = fs.createReadStream(tempFile);
      const response = await fetch(`${API_BASE}/deploy/direct?projectId=${projectId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': stats.size.toString(),
        },
        body: fileStream as any,
        duplex: 'half',
      } as any);

      const result = (await response.json()) as any;

      // Clean up temporary local archive
      fs.unlinkSync(tempFile);

      if (!response.ok) {
        throw new Error(result.message || 'Direct upload request rejected by API server.');
      }

      const deploymentId = result.deploymentId;
      console.log(`✓ Archive accepted! Deployment created with ID: ${deploymentId}`);
      console.log('\n--- Build Logs Stream ---');

      // 3. Connect to WebSocket log stream to output progress live
      await new Promise<void>((resolve, reject) => {
        const wsUrl = `${WS_BASE}/deployments/${deploymentId}/logs/stream?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.event === 'end') {
              console.log('\n-------------------------');
              if (parsed.status === 'ready') {
                console.log(`\n🎉 DEPLOYMENT SUCCESSFUL!`);
                console.log(`👉 Live site URL: ${result.url}`);
              } else {
                console.error(`\n❌ Deployment finished with state: ${parsed.status}`);
              }
              ws.close();
              resolve();
            } else if (parsed.line) {
              console.log(parsed.line);
            }
          } catch {
            console.log(data.toString());
          }
        });

        ws.on('error', (wsErr) => {
          console.error('WebSocket logs stream connection error:', wsErr);
          reject(wsErr);
        });

        ws.on('close', () => {
          resolve();
        });
      });

    } catch (err: any) {
      console.error('\n❌ Deployment Failed:', err.message || err);
      // Clean up file if it exists
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
