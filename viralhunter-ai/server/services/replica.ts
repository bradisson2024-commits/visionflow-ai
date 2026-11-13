// ReplicaPro: análisis del canal, estilo y voz, branding y vídeos.
import type { ChannelInfo, VideoInfo } from "../../shared/types";
import { sql } from "../db";
import { missing, aiCredKeys } from "../env";
import * as yt from "./youtube";
import * as ai from "./ai";
import { generateImages } from "./images";
import { daysSince, detectLanguage, median } from "./scoring";

export type StepEmit = (e: { type: "step"; step: number; status: "running" | "done" | "error"; label: string; detail?: string }) => void;

export interface PublishingPatterns {
  analyzedVideos: number;
  uploadsPerWeek90d: number;
  medianDaysBetweenUploads: number | null;
  weekdayDistribution: { day: string; count: number }[];
  hourDistributionUTC: { hour: number; count: number }[];
  durationBuckets: { label: string; count: number; medianViews: number }[];
  avgViews: number;
  medianViews: number;
  titles: { avgLength: number; withNumbers: number; withQuestion: number; withEmoji: number; withAllCapsWord: number };
  firstUpload: string | null;
  lastUpload: string | null;
}

export interface ChannelAnalysis {
  channel: ChannelInfo;
  language: string;
  topVideos: VideoInfo[];
  recentVideos: VideoInfo[];
  patterns: PublishingPatterns;
  formats: ai.FormatAnalysisT | null;
  formatsNote?: string;
  quotaUsed: number;
}

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function computePatterns(videos: VideoInfo[]): PublishingPatterns {
  const sorted = [...videos].sort((a, b) => +new Date(a.publishedAt) - +new Date(b.publishedAt));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((+new Date(sorted[i].publishedAt) - +new Date(sorted[i - 1].publishedAt)) / 86400_000);
  const wd = new Array(7).fill(0);
  const hr = new Array(24).fill(0);
  for (const v of videos) {
    const d = new Date(v.publishedAt);
    wd[d.getUTCDay()]++;
    hr[d.getUTCHours()]++;
  }
  const buckets = [
    { label: "≤ 1 min", test: (s: number) => s <= 60 },
    { label: "1–3 min", test: (s: number) => s > 60 && s <= 180 },
    { label: "3–10 min", test: (s: number) => s > 180 && s <= 600 },
    { label: "10–20 min", test: (s: number) => s > 600 && s <= 1200 },
    { label: "20–60 min", test: (s: number) => s > 1200 && s <= 3600 },
    { label: "> 60 min", test: (s: number) => s > 3600 },
  ].map((b) => {
    const vs = videos.filter((v) => v.durationSec !== null && b.test(v.durationSec!));
    return { label: b.label, count: vs.length, medianViews: median(vs.map((v) => v.viewCount ?? 0)) };
  });
  const titles = videos.map((v) => v.title);
  const views = videos.map((v) => v.viewCount ?? 0);
  return {
    analyzedVideos: videos.length,
    uploadsPerWeek90d: Math.round((videos.filter((v) => daysSince(v.publishedAt) <= 90).length / (90 / 7)) * 10) / 10,
    medianDaysBetweenUploads: gaps.length ? Math.round(median(gaps) * 10) / 10 : null,
    weekdayDistribution: wd.map((count, i) => ({ day: DAYS[i], count })),
    hourDistributionUTC: hr.map((count, hour) => ({ hour, count })),
    durationBuckets: buckets,
    avgViews: views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0,
    medianViews: Math.round(median(views)),
    titles: {
      avgLength: titles.length ? Math.round(titles.reduce((s, t) => s + t.length, 0) / titles.length) : 0,
      withNumbers: titles.filter((t) => /\d/.test(t)).length,
      withQuestion: titles.filter((t) => /[?¿]/.test(t)).length,
      withEmoji: titles.filter((t) => /\p{Extended_Pictographic}/u.test(t)).length,
      withAllCapsWord: titles.filter((t) => /\b[A-ZÁÉÍÓÚÑ]{4,}\b/.test(t)).length,
    },
    firstUpload: sorted[0]?.publishedAt ?? null,
    lastUpload: sorted[sorted.length - 1]?.publishedAt ?? null,
  };
}

export const ANALYZE_STEPS = [
  "Identificando el canal",
  "Descargando la lista de vídeos",
  "Obteniendo estadísticas de cada vídeo",
  "Buscando los vídeos más vistos del canal",
  "Calculando patrones de publicación",
  "Identificando formatos de contenido",
  "Guardando el análisis",
];

export async function createProject(sourceUrl: string): Promise<string> {
  const [p] = await sql()`insert into projects (source_url) values (${sourceUrl}) returning id`;
  return p.id;
}

export async function getProject(id: string): Promise<Record<string, any> | null> {
  const [p] = await sql()`select * from projects where id = ${id}`;
  if (!p) return null;
  const assets = await sql()`select id, kind, provider, model, prompt, mime_type, meta, created_at from assets where project_id = ${id} order by created_at`;
  return { ...p, assets: assets.map((a: any) => ({ ...a, url: `/api/assets/${a.id}` })) };
}

export async function listProjects() {
  return sql()`select p.id, p.source_url, p.stage, p.created_at, p.updated_at, c.title as channel_title, c.thumbnail_url
    from projects p left join channels c on c.id = p.source_channel_id order by p.updated_at desc limit 50`;
}

export async function analyzeChannel(projectId: string, url: string, emit: StepEmit): Promise<ChannelAnalysis> {
  const tracker: yt.Tracker = { units: 0 };
  let cur = 0;
  const run = async <T>(n: number, f: () => Promise<[T, string]>): Promise<T> => {
    cur = n;
    emit({ type: "step", step: n, status: "running", label: ANALYZE_STEPS[n - 1] });
    const [v, detail] = await f();
    emit({ type: "step", step: n, status: "done", label: ANALYZE_STEPS[n - 1], detail });
    return v;
  };
  try {
    const channel = await run(1, async () => {
      const c = await yt.resolveChannel(url, tracker);
      if (!c) throw new Error("No se encontró ningún canal de YouTube con ese enlace.");
      return [c, `${c.title} · ${c.subscriberCount === null ? "suscriptores ocultos" : c.subscriberCount.toLocaleString("es-ES") + " suscriptores"}`];
    });
    const ids = await run(2, async () => {
      const ids = channel.uploadsPlaylistId ? await yt.getUploads(channel.uploadsPlaylistId, 100, tracker) : [];
      return [ids, `${ids.length} vídeos recientes`];
    });
    const recent = await run(3, async () => {
      const v = await yt.getVideos(ids, tracker);
      return [v, `${v.length} vídeos con estadísticas`];
    });
    const top = await run(4, async () => {
      const hits = await yt.searchVideos({ q: "", channelId: channel.id, order: "viewCount", maxResults: 25 }, tracker);
      const known = new Map(recent.map((v) => [v.id, v]));
      const missingIds = hits.map((h) => h.videoId).filter((id) => !known.has(id));
      const extra = missingIds.length ? await yt.getVideos(missingIds, tracker) : [];
      const all = [...known.values(), ...extra];
      const top = all.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 20);
      return [top, top[0] ? `Más visto: «${top[0].title}» (${(top[0].viewCount ?? 0).toLocaleString("es-ES")} vistas)` : "Sin vídeos públicos"];
    });
    const patterns = await run(5, async () => {
      const p = computePatterns(recent);
      return [p, `${p.uploadsPerWeek90d} vídeos/semana · mediana ${p.medianViews.toLocaleString("es-ES")} vistas`];
    });
    let formatsNote: string | undefined;
    const formats = await run(6, async () => {
      if (missing(...aiCredKeys()).length) {
        formatsNote = `IA no configurada (${aiCredKeys().join(", ")}): análisis de formatos no disponible.`;
        return [null, formatsNote];
      }
      const pool = new Map([...top, ...recent.slice(0, 40)].map((v) => [v.id, v]));
      const f = await ai.analyzeFormats({
        channel: channel.title,
        videos: [...pool.values()].map((v) => ({ title: v.title, views: v.viewCount, durationSec: v.durationSec, publishedAt: v.publishedAt })),
      });
      return [f, `${f.formats.length} formatos detectados (análisis IA)`];
    });
    const language =
      (channel.defaultLanguage ?? "").split("-")[0] ||
      (recent.find((v) => v.defaultAudioLanguage)?.defaultAudioLanguage ?? "").split("-")[0] ||
      detectLanguage(recent.map((v) => v.title)) ||
      "es";
    const analysis: ChannelAnalysis = { channel, language, topVideos: top, recentVideos: recent.slice(0, 50), patterns, formats, formatsNote, quotaUsed: tracker.units };
    await run(7, async () => {
      await sql()`update projects set source_channel_id = ${channel.id}, source_url = ${url}, channel_analysis = ${sql().json(analysis as any)},
        stage = 1, style_analysis = null, style_approved = false, branding_proposals = null, branding_selected = null, branding_approved = false,
        video_proposals = null, updated_at = now() where id = ${projectId}`;
      return [null, `${tracker.units} unidades de cuota de YouTube`];
    });
    return analysis;
  } catch (e) {
    emit({ type: "step", step: cur, status: "error", label: ANALYZE_STEPS[cur - 1] ?? "", detail: (e as Error).message });
    throw e;
  }
}

async function requireProject(id: string) {
  const p = await getProject(id);
  if (!p) throw Object.assign(new Error("Proyecto no encontrado"), { status: 404 });
  return p;
}

export async function analyzeStyle(projectId: string) {
  const p = await requireProject(projectId);
  const a = p.channel_analysis as ChannelAnalysis | null;
  if (!a) throw Object.assign(new Error("Primero analiza el canal (etapa 1)."), { status: 400 });
  const style = await ai.analyzeStyle({
    channel: a.channel.title,
    description: a.channel.description,
    videos: a.topVideos.slice(0, 8).map((v) => ({ title: v.title, description: v.description, thumbnailUrl: v.thumbnailUrl, durationSec: v.durationSec, views: v.viewCount })),
  });
  await sql()`update projects set style_analysis = ${sql().json(style as any)}, stage = greatest(stage, 2), updated_at = now() where id = ${projectId}`;
  return style;
}

export async function referenceImages(projectId: string, extra?: string) {
  const p = await requireProject(projectId);
  const s = p.style_analysis as ai.StyleAnalysisT | null;
  if (!s) throw Object.assign(new Error("Primero ejecuta el análisis de estilo."), { status: 400 });
  const prompt =
    `${s.imagePromptBase}. ${extra ?? ""} Original artwork, no logos, no text, no real people's likeness, no copyrighted characters. ` +
    `Color palette: ${s.colors.map((c) => c.hex).join(", ")}.`;
  return generateImages({ projectId, kind: "style_ref", prompt, size: "1536x1024", n: 2 });
}

export async function characterImage(projectId: string, description: string) {
  const p = await requireProject(projectId);
  const s = p.style_analysis as ai.StyleAnalysisT | null;
  if (!s) throw Object.assign(new Error("Primero ejecuta el análisis de estilo."), { status: 400 });
  const prompt =
    `Original character design sheet for a YouTube channel mascot/narrator: ${description}. ` +
    `Art style: ${s.visualStyle}. ${s.illustrations}. Palette: ${s.colors.map((c) => c.hex).join(", ")}. ` +
    `Full body, front view, neutral background, no text, not resembling any existing copyrighted character.`;
  return generateImages({ projectId, kind: "character", prompt, size: "1024x1024", n: 1 });
}

export async function approveStyle(projectId: string, choices: unknown) {
  const p = await requireProject(projectId);
  if (!p.style_analysis) throw Object.assign(new Error("No hay análisis de estilo que aprobar."), { status: 400 });
  await sql()`update projects set style_choices = ${sql().json(choices as any)}, style_approved = true, stage = greatest(stage, 3), updated_at = now() where id = ${projectId}`;
}

export const BRANDING_STEPS = ["Creando nombres y descripciones", "Diseñando logos", "Diseñando banners", "Guardando propuestas"];

export async function generateBranding(projectId: string, emit: StepEmit) {
  const p = await requireProject(projectId);
  if (!p.style_approved) throw Object.assign(new Error("Aprueba el estilo en la etapa 2 antes del branding."), { status: 400 });
  const a = p.channel_analysis as ChannelAnalysis;
  const choices = (p.style_choices ?? {}) as any;
  let cur = 0;
  const step = (n: number, status: "running" | "done", detail?: string) => {
    cur = n;
    emit({ type: "step", step: n, status, label: BRANDING_STEPS[n - 1], detail });
  };
  try {
    step(1, "running");
    const r = await ai.generateBranding({
      sourceChannel: a.channel.title,
      niche: a.formats?.summary ?? a.channel.description.slice(0, 300),
      language: choices.language ?? a.language,
      style: p.style_analysis,
      character: choices.character?.mode === "create" ? choices.character.description : null,
    });
    const proposals: any[] = r.proposals.slice(0, 3);
    step(1, "done", proposals.map((x) => x.name).join(" · "));
    step(2, "running");
    for (const [i, pr] of proposals.entries()) {
      const [logo] = await generateImages({
        projectId, kind: "logo", size: "1024x1024", n: 1, quality: "high",
        prompt: `${pr.logoPrompt}. Brand palette: ${pr.palette.map((c: any) => c.hex).join(", ")}. Visual identity: ${pr.visualIdentity}. Simple, scalable, centered, flat background, original design.`,
      });
      pr.logo = logo;
      emit({ type: "step", step: 2, status: "running", label: BRANDING_STEPS[1], detail: `Logo ${i + 1}/${proposals.length}` });
    }
    step(2, "done", `${proposals.length} logos`);
    step(3, "running");
    for (const [i, pr] of proposals.entries()) {
      const [banner] = await generateImages({
        projectId, kind: "banner", size: "1536x1024", n: 1,
        prompt: `${pr.bannerPrompt}. YouTube channel banner, wide composition with important elements in the central horizontal band. Palette: ${pr.palette.map((c: any) => c.hex).join(", ")}. Style consistent with: ${(p.style_analysis as any).visualStyle}. No text.`,
      });
      pr.banner = banner;
      emit({ type: "step", step: 3, status: "running", label: BRANDING_STEPS[2], detail: `Banner ${i + 1}/${proposals.length}` });
    }
    step(3, "done", `${proposals.length} banners`);
    step(4, "running");
    await sql()`update projects set branding_proposals = ${sql().json(proposals)}, branding_selected = null, branding_approved = false, updated_at = now() where id = ${projectId}`;
    step(4, "done");
    return proposals;
  } catch (e) {
    emit({ type: "step", step: cur, status: "error", label: BRANDING_STEPS[cur - 1] ?? "", detail: (e as Error).message });
    throw e;
  }
}

export async function approveBranding(projectId: string, index: number) {
  const p = await requireProject(projectId);
  const list = (p.branding_proposals ?? []) as any[];
  if (!list[index]) throw Object.assign(new Error("Propuesta no válida."), { status: 400 });
  await sql()`update projects set branding_selected = ${sql().json(list[index])}, branding_approved = true, stage = greatest(stage, 4), updated_at = now() where id = ${projectId}`;
}

export async function generateVideos(projectId: string, count: number) {
  const p = await requireProject(projectId);
  if (!p.branding_approved) throw Object.assign(new Error("Aprueba el branding en la etapa 3 antes de generar vídeos."), { status: 400 });
  const a = p.channel_analysis as ChannelAnalysis;
  const brand = { ...(p.branding_selected as any) };
  delete brand.logo;
  delete brand.banner;
  const r = await ai.generateVideoIdeas({
    brand,
    style: p.style_analysis,
    language: (p.style_choices as any)?.language ?? a.language,
    count,
    references: a.topVideos.slice(0, 12).map((v) => ({ title: v.title, views: v.viewCount, durationSec: v.durationSec, description: v.description, publishedAt: v.publishedAt })),
  });
  await sql()`update projects set video_proposals = ${sql().json(r as any)}, updated_at = now() where id = ${projectId}`;
  return r;
}

export async function videoThumbnail(projectId: string, index: number) {
  const p = await requireProject(projectId);
  const v = (p.video_proposals as any)?.proposals?.[index];
  if (!v) throw Object.assign(new Error("Propuesta de vídeo no encontrada."), { status: 400 });
  const brand = p.branding_selected as any;
  const [img] = await generateImages({
    projectId, kind: "thumbnail", size: "1536x1024", n: 1,
    prompt: `${v.thumbnailPrompt}. YouTube thumbnail, high contrast, readable focal point. Palette: ${(brand?.palette ?? []).map((c: any) => c.hex).join(", ")}. Style: ${(p.style_analysis as any)?.visualStyle ?? ""}. Original artwork.`,
  });
  const vp = p.video_proposals as any;
  vp.proposals[index].thumbnail = img;
  await sql()`update projects set video_proposals = ${sql().json(vp)}, updated_at = now() where id = ${projectId}`;
  return img;
}

export async function setStage(projectId: string, stage: number) {
  const p = await requireProject(projectId);
  const allowed = stage === 1 || (stage === 2 && !!p.channel_analysis) || (stage === 3 && p.style_approved) || (stage === 4 && p.branding_approved);
  if (!allowed) throw Object.assign(new Error("Completa la etapa anterior primero."), { status: 400 });
  return stage;
}
