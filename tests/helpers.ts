/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON dinámicas en pruebas */
/** Cliente HTTP mínimo con cookies para probar la API real en ejecución. */
export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export class Client {
  cookie = "";
  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const res = await fetch(BASE + path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = /cf_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `cf_session=${m[1]}` : "";
    }
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: res.status, body, headers: res.headers };
  }
}

export const uniqueEmail = (tag: string) => `test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
