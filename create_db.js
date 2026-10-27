const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

const createDB = async () => {
  try {
    await client.connect();
    const res = await client.query(`SELECT datname FROM pg_catalog.pg_database WHERE datname = 'petroleum_iot'`);
    if (res.rowCount === 0) {
      console.log('Database petroleum_iot not found, creating it...');
      await client.query('CREATE DATABASE petroleum_iot');
      console.log('Database created successfully.');
    } else {
      console.log('Database already exists.');
    }
  } catch (err) {
    console.error('Error creating database:', err);
  } finally {
    await client.end();
  }
};

createDB();
