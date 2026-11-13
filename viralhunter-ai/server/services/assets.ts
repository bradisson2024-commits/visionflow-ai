import { sql } from "../db";

export async function saveAsset(a: {
  projectId: string | null;
  kind: string;
  provider: string;
  model?: string;
  prompt?: string;
  mimeType: string;
  data: Buffer;
  meta?: Record<string, unknown>;
}): Promise<{ id: string; url: string }> {
  const [row] = await sql()`insert into assets (project_id, kind, provider, model, prompt, mime_type, data, meta)
    values (${a.projectId}, ${a.kind}, ${a.provider}, ${a.model ?? null}, ${a.prompt ?? null}, ${a.mimeType}, ${a.data},
      ${sql().json((a.meta ?? {}) as any)}) returning id`;
  return { id: row.id, url: `/api/assets/${row.id}` };
}

export async function loadAsset(id: string) {
  const [row] = await sql()`select mime_type, data from assets where id = ${id}`;
  return row ? { mimeType: row.mime_type as string, data: row.data as Buffer } : null;
}
