// Aplica las migraciones de supabase/migrations en orden (también sirven en el editor SQL de Supabase).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { sql, closeDb } from './index.js';
import { seedStyles } from '../modules/styles.js';
import { seedLibrary } from '../modules/music.js';

export async function migrate() {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const dir = path.join(ROOT, 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const done = await sql`select 1 from schema_migrations where name = ${f}`;
    if (done.length) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
      await tx`insert into schema_migrations(name) values (${f})`;
    });
    console.log(`  migración aplicada: ${f}`);
  }
  await seedStyles();
  await seedLibrary();
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => { console.log('Base de datos lista.'); return closeDb(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
