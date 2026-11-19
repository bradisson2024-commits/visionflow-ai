/**
 * Importación de video desde un enlace.
 *
 * Se aceptan enlaces que apuntan directamente a un archivo de video (servidor
 * propio, almacenamiento en la nube, Dropbox, Google Drive públicos).
 * Los enlaces de plataformas cuyos términos prohíben la descarga con
 * herramientas externas (YouTube, TikTok, Instagram, Facebook, X, Twitch, Vimeo)
 * se rechazan con una explicación y la alternativa permitida.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../http";
import { enqueueJob } from "../queue";
import { getOwnedProject } from "./projects";
import { partPath, removeExistingVideos } from "./videos";
import { ALLOWED_EXTENSIONS, extensionOf } from "@/lib/media-rules";

const PLATFORMS: { match: RegExp; name: string; help: string }[] = [
  { match: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i, name: "YouTube", help: "Si el video es tuyo, descárgalo desde YouTube Studio (Contenido → ⋮ → Descargar) y súbelo aquí." },
  { match: /(^|\.)tiktok\.com$/i, name: "TikTok", help: "Si el video es tuyo, guárdalo desde la app de TikTok o solicita tus datos y súbelo aquí." },
  { match: /(^|\.)(instagram\.com|instagr\.am)$/i, name: "Instagram", help: "Descarga tu contenido desde Configuración → Tu actividad → Descargar tu información, y súbelo aquí." },
  { match: /(^|\.)(facebook\.com|fb\.watch)$/i, name: "Facebook", help: "Descarga tu video desde Meta Business Suite o “Descargar tu información”, y súbelo aquí." },
  { match: /(^|\.)(twitter\.com|x\.com)$/i, name: "X", help: "Descarga tu archivo de datos de X y sube el video aquí." },
  { match: /(^|\.)(twitch\.tv)$/i, name: "Twitch", help: "Descarga tus VODs desde el Productor de video de Twitch y súbelos aquí." },
  { match: /(^|\.)(vimeo\.com)$/i, name: "Vimeo", help: "Usa el botón de descarga de Vimeo (si el propietario lo permite) y sube el archivo aquí." },
];

export function detectPlatform(host: string) {
  return PLATFORMS.find((p) => p.match.test(host)) ?? null;
}

/** Convierte enlaces de “compartir” en enlaces de descarga directa cuando el servicio lo permite. */
export function normalizeShareUrl(u: URL): URL {
  const url = new URL(u);
  if (/(^|\.)dropbox\.com$/i.test(url.hostname)) {
    url.searchParams.set("dl", "1");
    return url;
  }
  if (url.hostname === "drive.google.com") {
    const id = /\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("id");
    if (id) return new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`);
  }
  if (url.hostname === "1drv.ms" || /onedrive\.live\.com$/i.test(url.hostname)) {
    url.searchParams.set("download", "1");
  }
  return url;
}

const allowPrivate = () => process.env.IMPORT_ALLOW_PRIVATE_HOSTS === "true";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Valida el destino (protección SSRF: no se permite apuntar a la red interna del servidor). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "El enlace no es una URL válida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Sólo se admiten enlaces http(s).");
  if (url.username || url.password) throw new HttpError(400, "El enlace no puede incluir credenciales.");
  const platform = detectPlatform(url.hostname);
  if (platform)
    throw new HttpError(
      422,
      `${platform.name} no permite descargar sus videos con herramientas externas según sus términos de uso, así que ClipForge no los descarga. ${platform.help}`,
      { platform: platform.name },
    );
  if (!allowPrivate()) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addrs: { address: string }[];
    try {
      addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    } catch {
      throw new HttpError(400, `No se encontró el servidor ${url.hostname}.`);
    }
    if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, "El enlace apunta a una dirección privada o local, que no está permitida.");
  }
  return url;
}

function filenameFromUrl(url: URL, disposition?: string | null): string {
  const fromHeader = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const name = decodeURIComponent(fromHeader || url.pathname.split("/").pop() || "video");
  return name.slice(0, 200) || "video";
}

/** Crea el video en estado “subiendo” y encola la descarga en segundo plano. */
export async function startUrlImport(userId: string, projectId: string, rawUrl: string) {
  const project = await getOwnedProject(userId, projectId);
  const url = normalizeShareUrl(await assertPublicUrl(rawUrl));
  // Sustituye un video previo del proyecto.
  await removeExistingVideos(project.id);
  const [video] = await db
    .insert(schema.videos)
    .values({ projectId: project.id, originalFilename: filenameFromUrl(url), storageKey: "", source: "url", sourceUrl: rawUrl.trim() })
    .returning();
  await db.update(schema.projects).set({ status: "uploading" }).where(eq(schema.projects.id, project.id));
  const job = await enqueueJob({ type: "import_url", projectId: project.id, videoId: video.id, stage: "queued", params: { url: url.toString() } });
  return { video, job };
}

export type DownloadProgress = (received: number, total: number | null) => Promise<void> | void;

/**
 * Descarga el archivo (ejecutado por el worker). Revalida cada redirección,
 * aplica el límite de tamaño y se puede abortar.
 */
export async function downloadToPart(videoId: string, startUrl: string, maxBytes: number, signal: AbortSignal, onProgress: DownloadProgress) {
  let url = new URL(startUrl);
  let res: Response | null = null;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(url.toString());
    res = await fetch(url, { redirect: "manual", signal, headers: { "user-agent": "ClipForge-Importer/1.0" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new Error(`El servidor respondió ${res?.status ?? "sin respuesta"} al descargar el enlace.`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const name = filenameFromUrl(url, res.headers.get("content-disposition"));
  if (type.startsWith("text/html"))
    throw new Error("El enlace abre una página web, no un archivo de video. Usa un enlace de descarga directa.");
  if (type && !type.startsWith("video/") && !type.includes("octet-stream") && !type.includes("binary"))
    throw new Error(`El enlace no devuelve un video (tipo recibido: ${type}).`);
  const total = Number(res.headers.get("content-length")) || null;
  if (total && total > maxBytes) throw new Error(`El video supera el máximo permitido (${Math.round(maxBytes / 1048576)} MB).`);

  const out = createWriteStream(await partPath(videoId));
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength;
      if (received > maxBytes) throw new Error(`El video supera el máximo permitido (${Math.round(maxBytes / 1048576)} MB).`);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
      if (Date.now() - lastReport > 700) {
        lastReport = Date.now();
        await onProgress(received, total);
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    await rm(await partPath(videoId), { force: true });
    throw err;
  }
  await onProgress(received, total);
  const ext = extensionOf(name);
  const filename = (ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ? name : `${name.replace(/\.[^.]*$/, "")}.mp4`;
  return { received, filename, contentType: type || null };
}
