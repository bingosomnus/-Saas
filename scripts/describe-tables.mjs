import { createPool } from 'mysql2/promise';

const tables = process.argv.slice(2);
if (!tables.length) {
  console.error('Usage: node scripts/describe-tables.mjs table1 table2 ...');
  process.exit(1);
}

const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 1
});

try {
  const result = {};
  for (const table of tables) {
    const [columns] = await pool.execute(`
      select
        column_name as columnName,
        column_type as columnType,
        is_nullable as nullable,
        column_comment as columnComment
      from information_schema.columns
      where table_schema = database()
        and table_name = ?
      order by ordinal_position
    `, [table]);
    result[table] = columns;
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
