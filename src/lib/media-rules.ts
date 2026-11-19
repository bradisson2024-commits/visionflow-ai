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
