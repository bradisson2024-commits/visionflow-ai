/** Reglas de importación compartidas por cliente y servidor. */
export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"] as const;
export const ACCEPT_ATTR = "video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.m4v,.webm,.mkv,.avi";
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB por parte

export function extensionOf(name: string): string {
  const m = /\.[a-z0-9]+$/i.exec(name.trim());
  return m ? m[0].toLowerCase() : "";
}

export function checkVideoFile(name: string, size: number, maxMb: number): string | null {
  const ext = extensionOf(name);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext))
    return `Formato no compatible (${ext || "sin extensión"}). Usa ${ALLOWED_EXTENSIONS.join(", ")}.`;
  if (size <= 0) return "El archivo está vacío.";
  if (size > maxMb * 1024 * 1024) return `El archivo supera el máximo permitido (${maxMb} MB).`;
  return null;
}

/** Plataformas que se importan con yt-dlp (detección en el cliente para pedir la confirmación de derechos). */
export const PLATFORM_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|tiktok\.com|instagram\.com|instagr\.am|facebook\.com|fb\.watch|twitter\.com|x\.com|twitch\.tv|vimeo\.com)$/i;

export function platformOf(raw: string): string | null {
  try {
    const h = new URL(raw.trim()).hostname;
    if (!PLATFORM_HOST_RE.test(h)) return null;
    if (/youtu/.test(h)) return "YouTube";
    if (/tiktok/.test(h)) return "TikTok";
    if (/instagr/.test(h)) return "Instagram";
    if (/facebook|fb\.watch/.test(h)) return "Facebook";
    if (/twitch/.test(h)) return "Twitch";
    if (/vimeo/.test(h)) return "Vimeo";
    return "X";
  } catch {
    return null;
  }
}

/** Ajustes por defecto del análisis automático tras importar. */
export const DEFAULT_AUTO_ANALYZE = {
  mode: "full" as const,
  clipLength: { preset: "medium" as const, minSec: 30, maxSec: 60 },
  maxClips: 10,
  language: "auto",
  aspectRatio: "9:16" as const,
  captionStyle: "viral",
  reuseTranscript: true,
};
