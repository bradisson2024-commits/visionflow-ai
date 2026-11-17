// Créditos. 1 crédito = 0,001 USD de coste de proveedor (configurable). Cada operación se cobra según la tarifa
// configurada para el proveedor conectado; el consumo queda en el libro de créditos (credit_ledger).
import { sql } from '../db/index.js';
import { AppError } from './errors.js';

// Tarifas de referencia en USD por unidad. Revísalas con los precios vigentes de tus proveedores en Ajustes → Créditos.
export const DEFAULT_PRICING = {
  usdPerCredit: 0.001,
  ops: {
    'texto.guion': { usd: 0.01, unit: 'guion', label: 'Guion / análisis con IA' },
    'texto.analisis': { usd: 0.01, unit: 'análisis', label: 'Análisis de vídeo o canal con IA' },
    'imagen.generar': { usd: 0.039, unit: 'imagen', label: 'Imagen (Gemini Imagen)' },
    'imagen.referencia': { usd: 0.039, unit: 'imagen', label: 'Referencia de personaje' },
    'video.veo': { usd: 0.4, unit: 'segundo', label: 'Animación con Veo (por segundo)' },
    'video.camara': { usd: 0, unit: 'escena', label: 'Movimiento de cámara con FFmpeg' },
    'voz.gemini': { usd: 0.0002, unit: 'palabra', label: 'Voz Gemini TTS (por palabra)' },
    'voz.elevenlabs': { usd: 0.0005, unit: 'palabra', label: 'Voz ElevenLabs (por palabra)' },
    'voz.edge': { usd: 0, unit: 'palabra', label: 'Voz Microsoft Edge (gratis)' },
    'export.mp4': { usd: 0, unit: 'exportación', label: 'Exportación MP4 (FFmpeg local)' },
    'youtube.busqueda': { usd: 0, unit: 'búsqueda', label: 'Búsqueda en YouTube (gasta cuota de Google, no créditos)' },
  },
};

export async function pricing() {
  const [row] = await sql`select value from app_settings where key = 'pricing'`;
  const p = row?.value || {};
  return { usdPerCredit: p.usdPerCredit || DEFAULT_PRICING.usdPerCredit, ops: { ...DEFAULT_PRICING.ops, ...(p.ops || {}) } };
}

/** Créditos que cuesta `units` unidades de la operación. */
export async function cost(op, units = 1) {
  const p = await pricing();
  const o = p.ops[op];
  if (!o) throw new Error(`Operación sin tarifa: ${op}`);
  return Math.ceil((o.usd * units) / p.usdPerCredit);
}

export async function balance(userId) {
  const [{ b }] = await sql`select coalesce(sum(delta), 0)::int as b from credit_ledger where user_id = ${userId}`;
  return b;
}

export async function grant(userId, amount, reason = 'recarga') {
  await sql`insert into credit_ledger(user_id, delta, operation, detail) values (${userId}, ${amount}, 'recarga', ${sql.json({ reason })})`;
}

/** Cobra antes de la operación; si falla después, `refund` devuelve el importe. */
export async function charge(userId, op, units, detail = {}, projectId = null) {
  const amount = await cost(op, units);
  if (amount === 0) return { amount: 0, refund: async () => {} };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${userId}::text))`;
    const [{ b }] = await tx`select coalesce(sum(delta), 0)::int as b from credit_ledger where user_id = ${userId}`;
    if (b < amount) throw new AppError(402, `Créditos insuficientes: la operación cuesta ${amount} y tienes ${b}.`);
    const [row] = await tx`insert into credit_ledger(user_id, delta, operation, detail, project_id) values (${userId}, ${-amount}, ${op}, ${sql.json({ units, ...detail })}, ${projectId}) returning id`;
    return { amount, refund: async (why) => { await sql`insert into credit_ledger(user_id, delta, operation, detail, project_id) values (${userId}, ${amount}, ${'reembolso'}, ${sql.json({ of: row.id, why })}, ${projectId})`; } };
  });
}
