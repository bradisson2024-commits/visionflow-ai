import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { checkRateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { handle, HttpError, json, parseBody } from "@/server/http";
import { loginSchema } from "@/lib/validation";

export const POST = handle(async (req: Request) => {
  const { email, password } = await parseBody(req, loginSchema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${email}`;
  if (!checkRateLimit(key)) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash)))
    throw new HttpError(401, "Correo o contraseña incorrectos.");

  resetRateLimit(key);
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ user: { id: user.id, name: user.name, email: user.email } });
});
