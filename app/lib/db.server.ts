// import mysql from 'mysql2/promise';

// interface DBConfig {
//   host: string;
//   user: string;
//   password?: string;
//   database: string;
//   port?: number;
// }

// const dbConfig: DBConfig = {
//   host: process.env.DB_HOST || 'localhost',
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME || 'bharatai',
//   port: Number(process.env.DB_PORT) || 3306,
// };

// // Create a connection pool
// const pool = mysql.createPool({
//   ...dbConfig,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// });

// export async function initDB() {
//   const connection = await pool.getConnection();
//   try {
//     await connection.query(`
//       CREATE TABLE IF NOT EXISTS rivinity_webbuilder_chats (
//         id VARCHAR(255) PRIMARY KEY,
//         urlId VARCHAR(255) UNIQUE,
//         description TEXT,
//         messages JSON,
//         timestamp DATETIME,
//         metadata JSON,
//         snapshot JSON
//       )
//     `);
//   } finally {
//     connection.release();
//   }
// }

// initDB().catch(console.error);

// export async function query<T>(sql: string, params?: any[]): Promise<T> {
//   const [results] = await pool.execute(sql, params);
//   return results as T;
// }

// export default pool;

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

const pool = new Pool({
  ...dbConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export async function initDB() {
  const client = await pool.connect();
  try {
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