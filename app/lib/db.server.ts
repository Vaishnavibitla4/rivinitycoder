import { Pool } from 'pg';

interface DBConfig {
  host: string;
  user: string;
  password?: string;
  database: string;
  port?: number;
}

const dbConfig: DBConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'builder',
  port: Number(process.env.DB_PORT) || 5432,
};

console.log({
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME,
  DB_PORT: process.env.DB_PORT,
});

const pool = new Pool({
  ...dbConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
});

export async function initDB() {
  console.log('Initializing DB...');

  const client = await pool.connect();

  try {
    console.log('Connected to DB');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rivinity_webbuilder_chats (
        id VARCHAR(255) PRIMARY KEY,
        "urlId" VARCHAR(255) UNIQUE,
        description TEXT,
        messages JSONB,
        timestamp TIMESTAMP,
        metadata JSONB,
        snapshot JSONB
      )
    `);
    console.log('Table check complete');
  } finally {
    client.release();
  }
}

initDB().catch(console.error);

export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export default pool;
