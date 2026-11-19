import { Readable } from "node:stream";
import { storage } from "../storage";

/** Sirve un archivo del almacenamiento con soporte de Range (búsqueda en el reproductor). */
export async function serveFile(req: Request, key: string, contentType: string, downloadName?: string) {
  const size = await storage.size(key);
  const headers = new Headers({
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });
  if (downloadName)
    headers.set("content-disposition", `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    start = Math.max(0, start);
    const r = await storage.read(key, { start, end });
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(Readable.toWeb(r.stream) as ReadableStream, { status: 206, headers });
  }
  const r = await storage.read(key);
  headers.set("content-length", String(size));
  return new Response(Readable.toWeb(r.stream) as ReadableStream, { status: 200, headers });
}
