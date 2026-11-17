// Investigación semanal automática. Cada ejecución lanza el Radar Viral y el Radar de Canales para cada nicho e
// idioma configurados, compara con lo ya visto (weekly_seen) y guarda un informe que separa lo NUEVO de lo repetido.
import { sql } from '../db/index.js';
import { enqueue, defineJob } from '../core/jobs.js';
import { AppError } from '../core/errors.js';
import { viralRadar, channelRadar } from './radar.js';
import { CATEGORY_LABELS } from './metrics.js';
import { GROUP_LABELS } from './monetization.js';

/** Próxima fecha (UTC) para el día de la semana y la hora indicados. */
export function nextRun(weekday, hour, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, 0, 0));
  let add = (weekday - d.getUTCDay() + 7) % 7;
  if (add === 0 && d <= from) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

export async function saveResearch(user, body) {
  const config = { niches: (body.niches || []).filter(Boolean).slice(0, 6), languages: (body.languages || ['es']).slice(0, 4), region: body.region || null, period: body.period || '7d', maxSubscribers: Number(body.maxSubscribers || 50000), channelMaxAgeDays: Number(body.channelMaxAgeDays || 180), thresholds: body.thresholds || {} };
  if (!config.niches.length) throw new AppError(400, 'Añade al menos un nicho.');
  const wd = Math.max(0, Math.min(6, Number(body.weekday ?? 1))), hr = Math.max(0, Math.min(23, Number(body.hour ?? 9)));
  if (body.id) {
    const [r] = await sql`update weekly_research set name = ${body.name || 'Investigación semanal'}, config = ${sql.json(config)}, weekday = ${wd}, hour = ${hr}, enabled = ${body.enabled !== false}, next_run_at = ${nextRun(wd, hr)} where id = ${body.id} and owner_id = ${user.id} returning *`;
    if (!r) throw new AppError(404, 'Investigación no encontrada');
    return r;
  }
  const [r] = await sql`insert into weekly_research(owner_id, name, config, weekday, hour, enabled, next_run_at) values (${user.id}, ${body.name || 'Investigación semanal'}, ${sql.json(config)}, ${wd}, ${hr}, ${body.enabled !== false}, ${nextRun(wd, hr)}) returning *`;
  return r;
}

export const listResearch = (user) => sql`select r.*, (select count(*)::int from weekly_reports w where w.research_id = r.id) as reports from weekly_research r where owner_id = ${user.id} order by created_at desc`;
export const listReports = async (user, id) => sql`select w.* from weekly_reports w join weekly_research r on r.id = w.research_id where r.id = ${id} and r.owner_id = ${user.id} order by w.created_at desc limit 52`;

export async function runNow(user, id) {
  const [r] = await sql`select * from weekly_research where id = ${id} and owner_id = ${user.id}`;
  if (!r) throw new AppError(404, 'Investigación no encontrada');
  return enqueue('semanal', { researchId: id }, { ownerId: user.id });
}

defineJob('semanal', async (job, { progress }) => {
  const [r] = await sql`select * from weekly_research where id = ${job.payload.researchId}`;
  if (!r) return 'Investigación eliminada';
  const [user] = await sql`select * from app_users where id = ${r.owner_id}`;
  const c = r.config;
  const found = [];
  const errors = [];
  const steps = c.niches.length * 2;
  let k = 0;
  for (const niche of c.niches) {
    try {
      const v = await viralRadar(user, { niche, languages: c.languages, region: c.region, period: c.period, thresholds: c.thresholds });
      for (const it of v.items.filter((x) => x.categories.length)) found.push({ type: 'video', id: it.item_id, niche, title: it.video.title, url: `https://www.youtube.com/watch?v=${it.item_id}`, channel: it.channel?.title, categories: it.categories.map((x) => CATEGORY_LABELS[x]), explanation: it.explanation, score: it.score });
    } catch (e) { errors.push(`Radar Viral «${niche}»: ${e.message}`); }
    await progress(++k / steps, `Nicho ${niche}: vídeos`);
    try {
      const ch = await channelRadar(user, { niche, languages: c.languages, region: c.region, maxSubscribers: c.maxSubscribers, channelMaxAgeDays: c.channelMaxAgeDays, period: '30d' });
      for (const it of ch.items) found.push({ type: 'canal', id: it.item_id, niche, title: it.channel.title, url: `https://www.youtube.com/channel/${it.item_id}`, monetization: GROUP_LABELS[it.monetization], monetizationGroup: it.monetization, categories: it.categories, explanation: it.explanation, score: it.score });
    } catch (e) { errors.push(`Radar de Canales «${niche}»: ${e.message}`); }
    await progress(++k / steps, `Nicho ${niche}: canales`);
  }
  // Comparación con informes anteriores
  const items = [];
  for (const f of found) {
    const [seen] = await sql`select first_seen from weekly_seen where research_id = ${r.id} and item_type = ${f.type} and item_id = ${f.id}`;
    if (seen) await sql`update weekly_seen set last_seen = now() where research_id = ${r.id} and item_type = ${f.type} and item_id = ${f.id}`;
    else await sql`insert into weekly_seen(research_id, item_type, item_id) values (${r.id}, ${f.type}, ${f.id})`;
    items.push({ ...f, isNew: !seen, firstSeen: seen?.first_seen || new Date().toISOString() });
  }
  const fresh = items.filter((x) => x.isNew);
  const nicheCount = {};
  for (const x of fresh) nicheCount[x.niche] = (nicheCount[x.niche] || 0) + 1;
  const [prev] = await sql`select summary from weekly_reports where research_id = ${r.id} order by created_at desc limit 1`;
  const emerging = Object.entries(nicheCount).filter(([n, cnt]) => cnt >= 2 && cnt > (prev?.summary?.newByNiche?.[n] || 0)).map(([n]) => n);
  const summary = {
    total: items.length, new: fresh.length, repeated: items.length - fresh.length,
    newVideos: fresh.filter((x) => x.type === 'video').length, newChannels: fresh.filter((x) => x.type === 'canal').length,
    newMonetizationSignals: fresh.filter((x) => x.monetizationGroup === 'senales' || x.monetizationGroup === 'confirmada').length,
    newByNiche: nicheCount, emergingNiches: emerging, errors,
    message: fresh.length ? `${fresh.length} resultados nuevos verificados esta semana.` : 'No hay resultados nuevos verificados esta semana: todo lo encontrado ya aparecía en informes anteriores o no superó los umbrales.',
  };
  await sql`insert into weekly_reports(research_id, summary, items) values (${r.id}, ${sql.json(summary)}, ${sql.json(items.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.score - a.score))})`;
  await sql`update weekly_research set last_run_at = now(), next_run_at = ${nextRun(r.weekday, r.hour)} where id = ${r.id}`;
  return summary.message;
});

/** Planificador: cada minuto encola las investigaciones vencidas. */
export function startScheduler() {
  const t = setInterval(async () => {
    try {
      const due = await sql`update weekly_research set next_run_at = next_run_at + interval '7 days' where enabled and next_run_at <= now() returning id, owner_id`;
      for (const d of due) await enqueue('semanal', { researchId: d.id }, { ownerId: d.owner_id });
    } catch { /* se reintenta en el siguiente minuto */ }
  }, 60000);
  t.unref?.();
}
