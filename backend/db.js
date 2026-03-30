const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
   port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function initDb() {
  await query("SELECT 1");
}

module.exports = { pool, query, initDb };
