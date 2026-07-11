import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';

export async function migrate() {
  console.log('Starting database migrations...');
  
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  try {
    // Read the schema.sql file
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }
    
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the schema script
    await pool.query(schemaSql);
    console.log('Database migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (process.argv[1] === __filename) {
  migrate();
}
