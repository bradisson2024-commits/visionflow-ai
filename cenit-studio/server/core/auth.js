// Autenticación. Con Supabase: el navegador inicia sesión con Supabase Auth y envía su JWT; el servidor lo verifica
// (JWKS del proyecto o secreto JWT heredado). Sin Supabase: cuentas locales (correo + contraseña con scrypt) y JWT propio.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { config, authMode } from '../config.js';
import { sql } from '../db/index.js';
import { AppError } from './errors.js';
import { grant } from './credits.js';

let jwks;
const localSecret = () => {
  if (!config.localJwtSecret) throw new AppError(500, 'Falta LOCAL_JWT_SECRET en el servidor (modo de cuentas locales).');
  return new TextEncoder().encode(config.localJwtSecret);
};

async function verifySupabase(token) {
  if (config.supabaseJwtSecret) {
    try { return (await jwtVerify(token, new TextEncoder().encode(config.supabaseJwtSecret))).payload; } catch { /* probar JWKS */ }
  }
  jwks ??= createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return (await jwtVerify(token, jwks)).payload;
}

/** Devuelve el usuario de la petición (crea su fila y sus créditos iniciales la primera vez). */
export async function userFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query?.token || null);
  if (!token) throw new AppError(401, 'Inicia sesión.');
  let payload;
  try { payload = authMode() === 'supabase' ? await verifySupabase(token) : (await jwtVerify(token, localSecret())).payload; }
  catch { throw new AppError(401, 'Sesión no válida o caducada. Vuelve a iniciar sesión.'); }
  const id = payload.sub, email = String(payload.email || '').toLowerCase();
  let [u] = await sql`select * from app_users where id = ${id}`;
  if (!u) {
    if (authMode() === 'local') throw new AppError(401, 'Usuario inexistente.');
    [u] = await sql`insert into app_users(id, email, is_admin) values (${id}, ${email}, ${config.adminEmails.includes(email)}) on conflict (id) do update set email = excluded.email returning *`;
    await grant(u.id, config.initialCredits, 'bienvenida');
  }
  return u;
}

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const check = (pw, stored) => { const [salt, h] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 64)); };

async function issue(u) {
  return new SignJWT({ email: u.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime('30d').sign(localSecret());
}

export async function localRegister(email, password) {
  if (authMode() !== 'local') throw new AppError(400, 'El registro se hace con Supabase Auth.');
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError(400, 'Correo no válido.');
  if (String(password || '').length < 8) throw new AppError(400, 'La contraseña debe tener al menos 8 caracteres.');
  const exists = await sql`select 1 from app_users where email = ${email}`;
  if (exists.length) throw new AppError(409, 'Ya existe una cuenta con ese correo.');
  const [{ n }] = await sql`select count(*)::int as n from app_users`;
  const [u] = await sql`insert into app_users(email, password_hash, is_admin) values (${email}, ${hash(password)}, ${n === 0 || config.adminEmails.includes(email)}) returning *`;
  await grant(u.id, config.initialCredits, 'bienvenida');
  return { token: await issue(u), user: publicUser(u) };
}

export async function localLogin(email, password) {
  if (authMode() !== 'local') throw new AppError(400, 'El inicio de sesión se hace con Supabase Auth.');
  const [u] = await sql`select * from app_users where email = ${String(email || '').trim().toLowerCase()}`;
  if (!u?.password_hash || !check(String(password || ''), u.password_hash)) throw new AppError(401, 'Correo o contraseña incorrectos.');
  return { token: await issue(u), user: publicUser(u) };
}

export const publicUser = (u) => ({ id: u.id, email: u.email, isAdmin: u.is_admin });
