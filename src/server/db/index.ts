import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../env";

// Reutiliza el pool entre recargas en desarrollo.
const g = globalThis as unknown as { __cfPool?: Pool };
const pool = g.__cfPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") g.__cfPool = pool;

export const db = drizzle(pool, { schema });
export { schema, pool };
