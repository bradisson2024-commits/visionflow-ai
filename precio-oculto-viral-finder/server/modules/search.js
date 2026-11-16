// Buscador de videos virales + historial. Todo con datos reales de YouTube Data API v3.
import { run, all, one, tx, json, parseJson } from '../db/index.js';
import * as yt from '../services/youtube.js';
import { scoreVideo } from './opportunities.js';

function saveVideo(v, subs) {
  run(`INSERT INTO videos(id, title, description, channel_id, channel_title, subscribers, published_at, duration_sec, views, likes, comments, thumbnail, language, tags, fetched_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, subscribers=excluded.subscribers, views=excluded.views,
         likes=excluded.likes, comments=excluded.comments, thumbnail=excluded.thumbnail, fetched_at=excluded.fetched_at`,
  v.id, v.title, v.description, v.channel_id, v.channel_title, subs ?? null, v.published_at, v.duration_sec, v.views, v.likes, v.comments, v.thumbnail, v.language, json(v.tags));
}

async function spanishCompetition(q) {
  const { ids } = await yt.searchIds({ q, days: 180, language: 'es', max: 25, minMinutes: 0 });
  if (!ids.length) return { count: 0, sample: 0 };
  const vs = await yt.videos(ids);
  return { count: vs.filter((v) => (v.views ?? 0) > 100000).length, sample: vs.length };
}

export async function runSearch({ query, language = 'es', days = 30, minMinutes = 4, competition = true }) {
  const q = String(query || '').trim();
  if (!q) throw Object.assign(new Error('Escribe un tema para buscar.'), { http: 400 });
  const before = yt.quotaUsedToday();
  let searchId;
  try {
    const found = await yt.searchIds({ q, days: Number(days), language, max: 25, minMinutes: Number(minMinutes) });
    const vids = found.ids.length ? await yt.videos(found.ids) : [];
    const subs = vids.length ? await yt.channelSubscribers([...new Set(vids.map((v) => v.channel_id))]) : {};
    const comp = competition && vids.length ? await spanishCompetition(q) : null;
    const scored = vids.map((v) => ({ v, s: scoreVideo(v, subs[v.channel_id] ?? null, comp) })).sort((a, b) => b.s.score - a.s.score);
    const used = yt.quotaUsedToday() - before;
    searchId = tx(() => {
      const r = run('INSERT INTO searches(query, language, period_days, min_minutes, result_count, quota_used) VALUES(?,?,?,?,?,?)', q, language, Number(days), Number(minMinutes), scored.length, used);
      const id = Number(r.lastInsertRowid);
      scored.forEach(({ v, s }, i) => {
        saveVideo(v, subs[v.channel_id]);
        run('INSERT INTO search_results(search_id, video_id, rank) VALUES(?,?,?)', id, v.id, i + 1);
        run('INSERT INTO opportunities(video_id, search_id, score, level, metrics, reasons) VALUES(?,?,?,?,?,?)', v.id, id, s.score, s.level, json({ ...s.metrics, parts: s.parts }), json(s.reasons));
      });
      return id;
    });
  } catch (e) {
    run(`INSERT INTO searches(query, language, period_days, min_minutes, status, error, quota_used) VALUES(?,?,?,?, 'error', ?, ?)`, q, language, Number(days), Number(minMinutes), e.message, yt.quotaUsedToday() - before);
    throw e;
  }
  return getSearch(searchId);
}

export function getSearch(id) {
  const s = one('SELECT * FROM searches WHERE id = ?', id);
  if (!s) return null;
  const results = all(`SELECT v.*, o.score, o.level, o.metrics, o.reasons, r.rank,
      (SELECT p.slug FROM projects p WHERE p.source_video = v.id ORDER BY p.id DESC LIMIT 1) AS project_slug
    FROM search_results r JOIN videos v ON v.id = r.video_id
    LEFT JOIN opportunities o ON o.video_id = v.id AND o.search_id = r.search_id
    WHERE r.search_id = ? ORDER BY r.rank`, id).map((r) => parseJson(r, 'metrics', 'reasons', 'tags'));
  return { ...s, results };
}

export const history = (limit = 100) => all('SELECT * FROM searches ORDER BY id DESC LIMIT ?', limit);
export const deleteSearch = (id) => run('DELETE FROM searches WHERE id = ?', id);
