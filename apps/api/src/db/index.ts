import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL || 'postgres://portway:portway-secure-pass@localhost:5433/portway';

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
  getPool: () => pool,
  close: () => pool.end(),
};
