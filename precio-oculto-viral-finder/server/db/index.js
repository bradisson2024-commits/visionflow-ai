// Acceso a la base de datos SQLite propia de la aplicación (node:sqlite, sin dependencias nativas).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../core/paths.js';

let db;

export function openDb(file = path.join(paths.data, 'viral-finder.db')) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}

export const getDb = () => db || openDb();

export const one = (sql, ...args) => getDb().prepare(sql).get(...args);
export const all = (sql, ...args) => getDb().prepare(sql).all(...args);
export const run = (sql, ...args) => getDb().prepare(sql).run(...args);

export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

/** Columnas JSON → objetos. */
export function parseJson(row, ...cols) {
  if (!row) return row;
  const out = { ...row };
  for (const c of cols) if (typeof out[c] === 'string') { try { out[c] = JSON.parse(out[c]); } catch { /* texto */ } }
  return out;
}

export const json = (v) => (v == null ? null : JSON.stringify(v));
