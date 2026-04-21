// 执行所有 migrations/*.sql（幂等）
// 用法：npm run db:init
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const sqlitePath = process.env.SQLITE_PATH ?? './data/db/homework.db';
const migrationsDir = path.resolve('src/db/migrations');

fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
const db = new Database(sqlitePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
  console.log(`applying ${f}...`);
  db.exec(sql);
}

console.log(`DB ready at ${sqlitePath}`);
db.close();
