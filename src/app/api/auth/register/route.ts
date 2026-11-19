import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { handle, HttpError, json, parseBody } from "@/server/http";
import { registerSchema } from "@/lib/validation";

export const POST = handle(async (req: Request) => {
  const { name, email, password } = await parseBody(req, registerSchema);
  const exists = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);
  if (exists.length) throw new HttpError(409, "Ya existe una cuenta con ese correo.");
  const [user] = await db
    .insert(schema.users)
    .values({ name, email, passwordHash: await hashPassword(password) })
    .returning({ id: schema.users.id, name: schema.users.name, email: schema.users.email });
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ user }, 201);
});
