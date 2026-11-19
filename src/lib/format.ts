export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: "Sin video",
  uploading: "Video subiendo",
  uploaded: "Video cargado",
  queued: "En cola",
  processing: "Procesando",
  ready: "Clips listos",
  error: "Error",
};

export const JOB_STAGE_LABEL: Record<string, string> = {
  queued: "En cola",
  extracting_audio: "Analizando audio",
  transcribing: "Transcribiendo",
  detecting_moments: "Detectando momentos",
  generating_clips: "Generando clips",
  rendering: "Renderizando",
  completed: "Completado",
  error: "Error",
};
