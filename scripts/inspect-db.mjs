import { createPool } from 'mysql2/promise';

const pool = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 1
});

try {
  const [versionRows] = await pool.query('select version() as version');
  const [tableRows] = await pool.query(`
    select table_name as tableName, table_comment as tableComment
    from information_schema.tables
    where table_schema = database()
    order by table_name
  `);

  const candidates = tableRows.filter(row => {
    const text = `${row.tableName} ${row.tableComment || ''}`.toLowerCase();
    return /dispatch|order|lead|clue|customer|store|shop|wechat|group|deposit|payment|pay|shipment|delivery|派|单|线索|客户|门店|加微|群|定金|支付|发货/.test(text);
  });

  console.log(JSON.stringify({
    version: versionRows[0]?.version,
    tableCount: tableRows.length,
    candidates: candidates.slice(0, 120)
  }, null, 2));
} finally {
  await pool.end();
}
