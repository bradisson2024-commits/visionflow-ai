import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { handle, HttpError, requireUser } from "@/server/http";
import { getOwnedProject } from "@/server/services/projects";
import { storage } from "@/server/storage";

const safeName = (s: string) => s.normalize("NFKD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip";

/**
 * Descarga un ZIP con los clips renderizados (y sus SRT si existen).
 * ?ids=a,b,c para una selección; sin ids, todos los clips listos del proyecto.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const project = await getOwnedProject(user.id, (await ctx.params).id);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const clips = await db.query.clips.findMany({
    where: and(eq(schema.clips.projectId, project.id), isNotNull(schema.clips.outputKey), ...(ids.length ? [inArray(schema.clips.id, ids)] : [])),
    orderBy: schema.clips.position,
  });
  if (!clips.length) throw new HttpError(404, "No hay clips renderizados para exportar. Genera los clips primero.");

  const zip = new ZipArchive({ store: true }); // el MP4 ya está comprimido
  const out = new PassThrough();
  zip.pipe(out);
  (async () => {
    try {
      for (const c of clips) {
        const name = `${String(c.position).padStart(2, "0")}-${safeName(c.title)}`;
        zip.append((await storage.read(c.outputKey!)).stream, { name: `${name}.mp4` });
        if (c.subtitleKey) zip.append((await storage.read(c.subtitleKey)).stream, { name: `${name}.srt` });
      }
      await zip.finalize();
    } catch (e) {
      zip.abort();
      out.destroy(e as Error);
    }
  })();
  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeName(project.name)}-clips.zip"`,
      "cache-control": "no-store",
    },
  });
});
