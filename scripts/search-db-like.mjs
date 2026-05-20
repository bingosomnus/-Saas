import { createPool } from 'mysql2/promise';

const value = process.argv[2];
if (!value) {
  console.error('Usage: node scripts/search-db-like.mjs value');
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
  const [columns] = await pool.execute(`
    select table_name as tableName, column_name as columnName
    from information_schema.columns
    where table_schema = database()
      and data_type in ('char', 'varchar', 'text', 'mediumtext', 'longtext')
    order by table_name, ordinal_position
  `);

  const hits = [];
  for (const { tableName, columnName } of columns) {
    const sql = `select count(*) as cnt from \`${tableName}\` where \`${columnName}\` like ?`;
    try {
      const [rows] = await pool.execute(sql, [`%${value}%`]);
      if (rows[0]?.cnt) hits.push({ tableName, columnName, count: rows[0].cnt });
    } catch {
      // Ignore inaccessible or incompatible columns.
    }
  }

  console.log(JSON.stringify(hits, null, 2));
} finally {
  await pool.end();
}
