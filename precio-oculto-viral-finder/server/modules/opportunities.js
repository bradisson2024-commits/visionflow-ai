// Detección de oportunidades: fórmula pública y reproducible, calculada sólo con datos reales de YouTube.
const clamp = (x) => Math.max(0, Math.min(1, x));
const MONEY = /(negocio|dinero|precio|cuesta|costo|coste|gana|ganan|millon|millones|empresa|secreto|oculto|verdad|estafa|truco|ricos?|rentable|cobran|paga|business|money|cost|price|secret|hidden|empire|billion|million|profit|scam|why .* (cheap|expensive)|how .* makes money)/i;

/**
 * @param {object} v video (views, likes, comments, published_at, title)
 * @param {number|null} subs suscriptores del canal
 * @param {{count:number, sample:number}|null} competition videos en español del mismo tema con >100.000 vistas (últimos 6 meses)
 */
export function scoreVideo(v, subs, competition, now = Date.now()) {
  const ageDays = Math.max(1, (now - Date.parse(v.published_at)) / 86400000);
  const views = v.views ?? 0;
  const vpd = views / ageDays;
  const outlier = subs ? views / subs : null;
  const engagement = views ? ((v.likes ?? 0) + 2 * (v.comments ?? 0)) / views : 0;
  const parts = {
    velocidad: Math.round(clamp(Math.log10(Math.max(1, vpd)) / 5) * 35),
    rendimiento: outlier == null ? 8 : Math.round(clamp(outlier / 20) * 30),
    interaccion: Math.round(clamp(engagement / 0.05) * 10),
    competencia: competition ? Math.round((1 - clamp(competition.count / 10)) * 15) : 7,
    encaje: MONEY.test(`${v.title} ${v.description?.slice(0, 300) || ''}`) ? 10 : 3,
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const level = score >= 65 ? 'alta' : score >= 40 ? 'media' : 'baja';
  const fmt = (n) => Math.round(n).toLocaleString('es');
  const reasons = [];
  reasons.push(`${fmt(vpd)} vistas por día en ${Math.round(ageDays)} días.`);
  if (outlier != null) reasons.push(outlier >= 3 ? `Tiene ${outlier.toFixed(1)}× más vistas que suscriptores: el tema funciona por sí mismo.` : `Vistas ${outlier.toFixed(1)}× sus suscriptores: depende más del tamaño del canal.`);
  else reasons.push('El canal oculta sus suscriptores: no se puede medir si es un caso atípico.');
  reasons.push(`Interacción ${(engagement * 100).toFixed(2)} % (me gusta + comentarios × 2 / vistas).`);
  if (competition) reasons.push(competition.count <= 2 ? `Poca competencia en español: ${competition.count} videos con más de 100.000 vistas en 6 meses.` : `Competencia en español: ${competition.count} de ${competition.sample} videos superan 100.000 vistas en 6 meses.`);
  else reasons.push('Competencia en español no medida en esta búsqueda.');
  reasons.push(parts.encaje >= 10 ? 'El tema encaja con El Precio Oculto (dinero, negocio o secreto detrás de algo).' : 'El encaje con El Precio Oculto no es evidente en el título.');
  return { score, level, parts, metrics: { ageDays: +ageDays.toFixed(1), viewsPerDay: Math.round(vpd), outlier: outlier == null ? null : +outlier.toFixed(2), engagement: +engagement.toFixed(4), subscribers: subs, competition }, reasons };
}
