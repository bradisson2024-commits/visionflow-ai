import { handle, json, parseBody, requireUser } from "@/server/http";
import { startUrlImport } from "@/server/services/url-import";
import { importSchema } from "@/lib/analyze-validation";

/** Importa un video desde un enlace (YouTube u otra plataforma con yt-dlp, o archivo directo). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { url, confirmRights, autoAnalyze } = await parseBody(req, importSchema);
  return json(await startUrlImport(user.id, id, url, { confirmRights, autoAnalyze }), 202);
});
