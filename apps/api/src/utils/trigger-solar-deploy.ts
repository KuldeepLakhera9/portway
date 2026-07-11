import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';

const db = new pg.Client({
  connectionString: databaseUrl,
});

async function run() {
  await db.connect();
  
  try {
    // 1. Fetch project details
    const res = await db.query(
      "SELECT id, webhook_secret, github_repo_url, branch FROM projects WHERE slug = 'solar-static-site' LIMIT 1"
    );
    
    if (res.rowCount === 0) {
      throw new Error("Project 'solar-static-site' was not found in the database. Please make sure you registered it first.");
    }
    
    const project = res.rows[0];
    console.log(`Found project ID: ${project.id}`);
    
    // 2. Prepare mock push payload matching the repo
    const mockCommitSha = crypto.randomBytes(20).toString('hex');
    const payload = {
      ref: `refs/heads/${project.branch}`,
      after: mockCommitSha,
      repository: {
        html_url: project.github_repo_url,
      },
      head_commit: {
        id: mockCommitSha,
        message: 'Simulated git push trigger',
        author: {
          name: 'Kuldeep Lakhera',
          username: 'KuldeepLakhera9'
        }
      }
    };
    
    const payloadString = JSON.stringify(payload);
    
    // 3. Sign the payload using the webhook secret
    const hmac = crypto.createHmac('sha256', project.webhook_secret);
    const signature = 'sha256=' + hmac.update(payloadString).digest('hex');
    
    console.log('Sending webhook payload to local server...');
    
    // 4. Send the signed payload to the local Fastify webhook receiver
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
    const deploymentId = result.deploymentId;
    console.log(`\n🌟 Webhook accepted! Deployment successfully created with ID: ${deploymentId}`);
    console.log('\nMonitoring build logs in progress...');
    
    // 5. Poll for deployment status changes
    let attempts = 0;
    const maxAttempts = 60;
    let finalStatus = 'queued';
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const deployQuery = await db.query(
        'SELECT status, url FROM deployments WHERE id = $1',
        [deploymentId]
      );
      
      if (deployQuery.rowCount > 0) {
        const d = deployQuery.rows[0];
        finalStatus = d.status;
        console.log(`[Status]: ${finalStatus} (Attempt ${attempts + 1}/${maxAttempts})`);
        
        if (finalStatus === 'ready' || finalStatus === 'error') {
          if (finalStatus === 'ready') {
            console.log(`\n🎉 BUILD COMPLETED SUCCESSFULLY!`);
            console.log(`👉 Visit your live site: http://${deploymentId}.localhost:3010/index.html`);
          } else {
            console.error('\n❌ Build execution failed. View the logs to debug.');
          }
          break;
        }
      }
      attempts++;
    }
    
  } catch (err: any) {
    console.error('Error triggering solar deploy:', err.message || err);
  } finally {
    await db.end();
  }
}

run();
