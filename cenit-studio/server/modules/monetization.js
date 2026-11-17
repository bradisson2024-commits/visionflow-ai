// Estado de monetización según la evidencia disponible. YouTube no publica el estado del Programa de Socios de
// cada canal, y que un vídeo muestre anuncios no demuestra que su propietario cobre. Por eso:
//  A · confirmada: sólo con evidencia directa y verificable registrada (fuente enlazada).
//  B · señales públicas: elementos públicos compatibles con funciones monetizadas (p. ej. enlace de membresías
//      del canal, que exige estar en el Programa de Socios) o promociones pagadas declaradas en la API.
//  C · potencial: parece reunir los requisitos de audiencia, según estimaciones con hipótesis visibles.
import { sql } from '../db/index.js';

// Requisitos publicados por YouTube para el Programa de Socios (revísalos en la ayuda oficial si cambian).
export const YPP = { full: { subs: 1000, watchHours365: 4000, shortsViews90: 10000000 }, early: { subs: 500, uploads90: 3, watchHours365: 3000, shortsViews90: 3000000 } };
export const DEFAULT_ASSUMPTIONS = { retention: 0.35 }; // fracción media vista de cada vídeo largo (hipótesis)

const MEMBERSHIP_RE = /youtube\.com\/(?:channel\/UC[\w-]{22}|@[\w.-]+|c\/[\w.-]+)\/join\b/i;

export async function monetizationFor(userId, channel, videos, assumptions = DEFAULT_ASSUMPTIONS) {
  const [ev] = await sql`select * from monetization_evidence where channel_id = ${channel.id} and owner_id = ${userId}`;
  const now = Date.now();
  const recent365 = videos.filter((v) => !v.is_short && now - Date.parse(v.published_at) <= 365 * 86400e3);
  const shorts90 = videos.filter((v) => v.is_short && now - Date.parse(v.published_at) <= 90 * 86400e3);
  const uploads90 = videos.filter((v) => now - Date.parse(v.published_at) <= 90 * 86400e3).length;
  const estHours = recent365.reduce((a, v) => a + (Number(v.views || 0) * (v.duration_sec || 0) * assumptions.retention) / 3600, 0);
  const shortsViews = shorts90.reduce((a, v) => a + Number(v.views || 0), 0);
  const subs = channel.subscribers;

  const signals = [];
  const texts = [channel.description || '', ...videos.map((v) => v.description || '')];
  if (texts.some((t) => MEMBERSHIP_RE.test(t))) signals.push('Enlace público de membresías del canal («/join»): las membresías sólo están disponibles para canales del Programa de Socios.');
  const paid = videos.filter((v) => v.paid_placement === true).length;
  if (paid) signals.push(`${paid} vídeo(s) declaran promoción pagada en YouTube (ingresos por patrocinio; no demuestra el Programa de Socios).`);

  const potentialWhy = [];
  const meetsFull = subs != null && subs >= YPP.full.subs && (estHours >= YPP.full.watchHours365 || shortsViews >= YPP.full.shortsViews90);
  const meetsEarly = subs != null && subs >= YPP.early.subs && uploads90 >= YPP.early.uploads90 && (estHours >= YPP.early.watchHours365 || shortsViews >= YPP.early.shortsViews90);
  potentialWhy.push(`Suscriptores públicos: ${subs == null ? 'ocultos' : subs.toLocaleString('es')}.`);
  potentialWhy.push(`Horas de visualización estimadas (vídeos largos de 12 meses, retención supuesta ${Math.round(assumptions.retention * 100)} %): ~${Math.round(estHours).toLocaleString('es')} h. YouTube no publica este dato.`);
  potentialWhy.push(`Vistas de Shorts publicados en 90 días: ${shortsViews.toLocaleString('es')} (sólo cuenta Shorts recientes de la muestra).`);

  let group = 'sin_indicios';
  if (ev) group = 'confirmada';
  else if (signals.length) group = 'senales';
  else if (meetsFull || meetsEarly) group = 'potencial';

  return {
    group,
    evidence: ev ? { source: ev.source_url, note: ev.note, at: ev.created_at } : null,
    signals,
    potential: { meetsFull, meetsEarly, estimatedWatchHours: Math.round(estHours), shortsViews90: shortsViews, uploads90, reasons: potentialWhy },
    disclaimer: group === 'confirmada'
      ? 'Confirmada por la evidencia registrada (fuente enlazada).'
      : 'No confirmada: YouTube no publica el estado del Programa de Socios de otros canales.',
  };
}

export const GROUP_LABELS = { confirmada: 'A · Monetización confirmada', senales: 'B · Señales públicas de monetización', potencial: 'C · Potencial de monetización', sin_indicios: 'Sin indicios suficientes' };
