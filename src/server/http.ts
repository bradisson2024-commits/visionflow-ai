/** Utilidades para los Route Handlers de la API REST. */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSessionUser, type SessionUser } from "./auth/session";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const json = <T>(data: T, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "No has iniciado sesión.");
  return user;
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "El cuerpo de la petición no es JSON válido.");
  }
  return schema.parse(raw);
}

/** Envuelve un handler para convertir errores en respuestas JSON coherentes. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, details: err.details }, err.status);
      if (err instanceof ZodError)
        return json({ error: err.issues[0]?.message ?? "Datos no válidos.", details: err.issues }, 400);
      console.error("[api] error no controlado:", err);
      return json({ error: "Error interno del servidor." }, 500);
    }
  };
}
