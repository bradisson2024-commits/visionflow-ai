import postgres from 'postgres';
import { config } from '../config.js';

let client;
export function db() {
  if (!client) {
    if (!config.databaseUrl) throw new Error('Falta DATABASE_URL (cadena de conexión de Postgres o de Supabase → Project Settings → Database).');
    client = postgres(config.databaseUrl, { max: 10, idle_timeout: 30, onnotice: () => {}, ssl: /supabase\.(co|com)/.test(config.databaseUrl) ? 'require' : false });
  }
  return client;
}
export const sql = new Proxy(function () {}, {
  apply: (_t, _this, args) => db()(...args),
  get: (_t, prop) => db()[prop],
});
export async function closeDb() { if (client) { await client.end({ timeout: 5 }); client = null; } }
