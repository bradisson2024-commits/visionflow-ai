import postgres from "postgres";
import { env, requireCreds } from "./env";

let _sql: postgres.Sql | null = null;

export function sql(): postgres.Sql {
  requireCreds("DATABASE_URL");
  if (!_sql) {
    _sql = postgres(env.databaseUrl, {
      max: 5,
      prepare: false, // compatible con el pooler de Supabase
      onnotice: () => {},
      types: {
        bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) },
      },
    });
  }
  return _sql;
}

export const json = (v: unknown) => sql().json(v as postgres.JSONValue);
