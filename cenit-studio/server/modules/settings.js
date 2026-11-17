import { sql } from '../db/index.js';
export async function getSetting(key) { const [r] = await sql`select value from app_settings where key = ${key}`; return r?.value ?? null; }
export async function setSetting(key, value) { await sql`insert into app_settings(key, value) values (${key}, ${sql.json(value)}) on conflict (key) do update set value = excluded.value, updated_at = now()`; }
