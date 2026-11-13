import type { ConfigStatus, MissingCredential } from "../../shared/types";

export class ApiError extends Error {
  constructor(message: string, public status: number, public missing?: MissingCredential[]) {
    super(message);
  }
}

const token = () => {
  try {
    return localStorage.getItem("vh_token") ?? "";
  } catch {
    return "";
  }
};

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const t = token();
  if (t) h["x-app-token"] = t;
  return h;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: headers(),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`, res.status, data.missing);
  return data as T;
}

/** POST que devuelve Server-Sent Events con el progreso real del servidor. */
export async function stream(path: string, body: unknown, onEvent: (e: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body ?? {}), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `Error ${res.status}`, res.status, data.missing);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data));
    }
  }
}

export const getConfig = () => api<ConfigStatus & { accessTokenRequired: boolean }>("/config");

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("es-ES").format(n));
export const compact = (n: number | null | undefined) =>
  n === null || n === undefined ? "oculto" : new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const date = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
export const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (d < 1) return "hoy";
  if (d === 1) return "hace 1 día";
  if (d < 30) return `hace ${d} días`;
  if (d < 365) return `hace ${Math.floor(d / 30)} meses`;
  return `hace ${Math.floor(d / 365)} años`;
};
export const duration = (s: number | null) => {
  if (s === null) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
