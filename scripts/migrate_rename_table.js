import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bharatai',
  port: Number(process.env.DB_PORT) || 3306,
};

async function migrate() {
  console.log('Connecting to database...', dbConfig.host);
  const connection = await mysql.createConnection(dbConfig);
  
  try {
    console.log('Creating table rivinity_webbuilder_chats...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS rivinity_webbuilder_chats (
        id VARCHAR(255) PRIMARY KEY,
        urlId VARCHAR(255) UNIQUE,
        description TEXT,
        messages JSON,
        timestamp DATETIME,
        metadata JSON,
        snapshot JSON
      )
    `);
    console.log('Table rivinity_webbuilder_chats created successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await connection.end();
  }
}

migrate();
