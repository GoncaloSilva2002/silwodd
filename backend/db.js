const { Pool, types } = require("pg");

// Os IDs da aplicacao sao BIGINT no PostgreSQL. O pg devolve BIGINT como
// string por omissao; aqui sao convertidos para Number para manter o contrato
// que o backend e o frontend ja utilizavam com MySQL.
types.setTypeParser(20, (value) => Number(value));

const connectionString = process.env.DATABASE_URL;
const useSsl = String(process.env.DB_SSL || "true").toLowerCase() !== "false";

const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || "postgres"
      }),
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_CONNECTION_LIMIT || 10)
});

function toPostgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query(sql, params = []) {
  try {
    const result = await pool.query(toPostgresPlaceholders(sql), params);
    const rows = result.rows;
    rows.affectedRows = result.rowCount || 0;
    return rows;
  } catch (error) {
    error.sqlMessage = error.message;
    throw error;
  }
}

async function initDb() {
  await query("SELECT 1");
}

module.exports = { pool, query, initDb };
