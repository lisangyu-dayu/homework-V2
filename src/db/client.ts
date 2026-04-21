import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '@/lib/config';

let cached: Database.Database | null = null;

export function getDb(): Database.Database {
  if (cached) return cached;
  const cfg = loadConfig();
  const dir = path.dirname(cfg.sqlitePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(cfg.sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  cached = db;
  return db;
}

export function closeDb(): void {
  cached?.close();
  cached = null;
}
