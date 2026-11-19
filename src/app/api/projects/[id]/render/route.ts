import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { handle, HttpError, json, parseBody, requireUser } from "@/server/http";
import { getOwnedProject } from "@/server/services/projects";
import { queueRender } from "@/server/services/clips";
import { exportSchema } from "@/lib/clip-validation";

const body = z.object({ clipIds: z.array(z.string().uuid()).min(1).max(100), exportOpts: exportSchema });

/** Renderiza varios clips a la vez (cada uno es un trabajo independiente en la cola). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const project = await getOwnedProject(user.id, (await ctx.params).id);
  const { clipIds, exportOpts } = await parseBody(req, body);
  const clips = await db.query.clips.findMany({ where: and(eq(schema.clips.projectId, project.id), inArray(schema.clips.id, clipIds)), columns: { id: true } });
  if (clips.length !== clipIds.length) throw new HttpError(404, "Algún clip no pertenece a este proyecto.");
  const queued: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const c of clips) {
    try {
      await queueRender(user.id, c.id, exportOpts);
      queued.push(c.id);
    } catch (e) {
      skipped.push({ id: c.id, reason: (e as Error).message });
    }
  }
  return json({ queued, skipped }, 202);
});
