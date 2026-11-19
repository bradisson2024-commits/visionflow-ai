import { z } from "zod";
import { handle, json, parseBody, requireUser } from "@/server/http";
import { startUrlImport } from "@/server/services/url-import";

const schema = z.object({ url: z.string().trim().min(1, "Pega un enlace.").max(2000) });

/** Importa un video desde un enlace de descarga directa (en segundo plano). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { url } = await parseBody(req, schema);
  return json(await startUrlImport(user.id, id, url), 202);
});
