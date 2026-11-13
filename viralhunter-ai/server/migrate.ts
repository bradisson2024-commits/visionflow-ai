import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const db = sql();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.unsafe(readFileSync(join(dir, f), "utf8"));
  console.log("migración aplicada:", f);
}
await db.end();
