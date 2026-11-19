/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON dinámicas en pruebas */
import { describe, expect, it } from "vitest";
import { Client, uniqueEmail } from "./helpers";

describe("Fase 1 — salud del sistema", () => {
  it("la base de datos, Redis y FFmpeg responden", async () => {
    const { status, body } = await new Client().req("/api/health");
    const byId = Object.fromEntries(body.checks.map((c: any) => [c.id, c.ok]));
    expect(byId).toMatchObject({ database: true, queue: true, ffmpeg: true, ffprobe: true });
    expect(status).toBe(200);
  });
});

describe("Fase 1 — usuarios y sesiones", () => {
  const email = uniqueEmail("auth");
  const a = new Client();

  it("rechaza datos de registro inválidos", async () => {
    const r = await new Client().req("/api/auth/register", { method: "POST", json: { name: "X", email: "no-es-correo", password: "123" } });
    expect(r.status).toBe(400);
  });

  it("registra un usuario y abre sesión con cookie httpOnly", async () => {
    const r = await a.req("/api/auth/register", { method: "POST", json: { name: "Ana Prueba", email, password: "contraseña-segura" } });
    expect(r.status).toBe(201);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const me = await a.req("/api/auth/me");
    expect(me.body.user.email).toBe(email);
  });

  it("no permite duplicar el correo (sin distinguir mayúsculas)", async () => {
    const r = await new Client().req("/api/auth/register", { method: "POST", json: { name: "Otra", email: email.toUpperCase(), password: "contraseña-segura" } });
    expect(r.status).toBe(409);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const r = await new Client().req("/api/auth/login", { method: "POST", json: { email, password: "mala-clave" } });
    expect(r.status).toBe(401);
  });

  it("inicia sesión y la cierra; la cookie antigua deja de valer", async () => {
    const c = new Client();
    expect((await c.req("/api/auth/login", { method: "POST", json: { email, password: "contraseña-segura" } })).status).toBe(200);
    const old = c.cookie;
    expect((await c.req("/api/auth/logout", { method: "POST" })).status).toBe(200);
    const stale = new Client();
    stale.cookie = old;
    expect((await stale.req("/api/auth/me")).status).toBe(401);
  });

  it("las páginas privadas redirigen a /login sin sesión", async () => {
    const r = await new Client().req("/dashboard");
    expect([307, 308]).toContain(r.status);
    expect(r.headers.get("location")).toContain("/login");
  });
});

describe("Fase 1 — proyectos persistentes", () => {
  const owner = new Client();
  const intruder = new Client();
  let projectId = "";

  it("prepara dos usuarios", async () => {
    await owner.req("/api/auth/register", { method: "POST", json: { name: "Dueño", email: uniqueEmail("owner"), password: "contraseña-segura" } });
    await intruder.req("/api/auth/register", { method: "POST", json: { name: "Intruso", email: uniqueEmail("intr"), password: "contraseña-segura" } });
  });

  it("exige sesión para la API de proyectos", async () => {
    expect((await new Client().req("/api/projects")).status).toBe(401);
  });

  it("crea un proyecto", async () => {
    const r = await owner.req("/api/projects", { method: "POST", json: { name: "Podcast episodio 1" } });
    expect(r.status).toBe(201);
    expect(r.body.project.status).toBe("draft");
    projectId = r.body.project.id;
  });

  it("rechaza nombres vacíos", async () => {
    expect((await owner.req("/api/projects", { method: "POST", json: { name: "   " } })).status).toBe(400);
  });

  it("lista y abre el proyecto (persistido en PostgreSQL)", async () => {
    const list = await owner.req("/api/projects");
    expect(list.body.projects.map((p: any) => p.id)).toContain(projectId);
    const det = await owner.req(`/api/projects/${projectId}`);
    expect(det.body.project.name).toBe("Podcast episodio 1");
    expect(det.body).toMatchObject({ videos: [], clips: [], jobs: [] });
  });

  it("renombra el proyecto", async () => {
    const r = await owner.req(`/api/projects/${projectId}`, { method: "PATCH", json: { name: "Podcast ep. 1 (final)" } });
    expect(r.body.project.name).toBe("Podcast ep. 1 (final)");
  });

  it("otro usuario no puede ver, renombrar ni borrar el proyecto", async () => {
    expect((await intruder.req(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await intruder.req(`/api/projects/${projectId}`, { method: "PATCH", json: { name: "hack" } })).status).toBe(404);
    expect((await intruder.req(`/api/projects/${projectId}`, { method: "DELETE" })).status).toBe(404);
    expect((await intruder.req("/api/projects")).body.projects).toHaveLength(0);
  });

  it("la página del proyecto se renderiza para su dueño", async () => {
    const r = await owner.req(`/projects/${projectId}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("Podcast ep. 1 (final)");
  });

  it("elimina el proyecto", async () => {
    expect((await owner.req(`/api/projects/${projectId}`, { method: "DELETE" })).status).toBe(200);
    expect((await owner.req(`/api/projects/${projectId}`)).status).toBe(404);
  });
});
