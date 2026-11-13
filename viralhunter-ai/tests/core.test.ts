import { describe, expect, it } from "vitest";
import { parseChannelInput, parseDuration } from "../server/services/youtube";
import { computeMetrics, dataTags, detectLanguage, estimateRevenue, scoreChannel, emergingNicheEvidence } from "../server/services/scoring";
import { nichesOfTheDay, NICHE_CATALOG } from "../server/services/niches";
import { computePatterns } from "../server/services/replica";
import type { ChannelInfo, VideoInfo } from "../shared/types";

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86400_000).toISOString();
const ch = (subs: number | null, ageDays: number): ChannelInfo => ({
  id: "UCx", title: "t", description: "", customUrl: null, thumbnailUrl: "", country: null, defaultLanguage: null,
  publishedAt: iso(ageDays), subscriberCount: subs, subscribersHidden: subs === null, viewCount: 0, videoCount: 0, uploadsPlaylistId: null,
});
const vid = (views: number, daysAgo: number, dur = 600, title = "video"): VideoInfo => ({
  id: Math.random().toString(36), title, thumbnailUrl: "", publishedAt: iso(daysAgo), viewCount: views, likeCount: null, commentCount: null, durationSec: dur,
});

describe("parseChannelInput", () => {
  it("reconoce formatos de URL de canal", () => {
    expect(parseChannelInput("https://www.youtube.com/@MiCanal")).toEqual({ kind: "handle", value: "@MiCanal" });
    expect(parseChannelInput("youtube.com/channel/UC1234567890123456789012")).toEqual({ kind: "id", value: "UC1234567890123456789012" });
    expect(parseChannelInput("https://www.youtube.com/user/pepe")).toEqual({ kind: "username", value: "pepe" });
    expect(parseChannelInput("https://youtu.be/abc123")).toEqual({ kind: "video", value: "abc123" });
    expect(parseChannelInput("https://www.youtube.com/watch?v=xyz")).toEqual({ kind: "video", value: "xyz" });
    expect(parseChannelInput("https://example.com/@x")).toBeNull();
  });
  it("parsea duraciones ISO-8601", () => {
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("PT45S")).toBe(45);
    expect(parseDuration("P1DT1S")).toBe(86401);
  });
});

describe("scoring", () => {
  it("puntúa más alto un canal pequeño y joven con un vídeo viral", () => {
    const small = ch(2000, 60);
    const vs = [vid(300000, 5), vid(20000, 12), vid(8000, 20)];
    const big = ch(900000, 3000);
    const vb = [vid(300000, 5), vid(250000, 12)];
    const s1 = scoreChannel(small, computeMetrics(small, vs, now));
    const s2 = scoreChannel(big, computeMetrics(big, vb, now));
    expect(s1.total).toBeGreaterThan(70);
    expect(s2.total).toBeLessThan(30);
    expect(s1.total).toBeLessThanOrEqual(100);
  });
  it("sólo etiqueta viral cuando los datos lo justifican", () => {
    const c = ch(5000, 100);
    const vs = [vid(100000, 3), vid(1000, 20)];
    const tags = dataTags(computeMetrics(c, vs, now), vs, now).map((t) => t.id);
    expect(tags).toContain("viral_7d");
    expect(tags).toContain("viral_month");
    const quiet = [vid(4000, 3)];
    expect(dataTags(computeMetrics(c, quiet, now), quiet, now)).toHaveLength(0);
  });
  it("estima ingresos con hipótesis explícitas", () => {
    const c = ch(500, 30);
    const vs = [vid(100000, 5)];
    const r = estimateRevenue(computeMetrics(c, vs, now), "es", "misterios", vs);
    expect(r.views30d).toBe(100000);
    expect(r.lowUsd).toBe(40);
    expect(r.highUsd).toBe(180);
    expect(r.monetizationEligible).toBe(false);
    expect(r.assumptions.join(" ")).toMatch(/no es una cifra oficial/);
  });
  it("detecta idioma por títulos", () => {
    expect(detectLanguage(["La historia de los que nunca volvieron", "El misterio de la casa en el bosque"])).toBe("es");
    expect(detectLanguage(["The story of the man who vanished", "What is the secret of the pyramids"])).toBe("en");
  });
  it("nicho emergente requiere evidencia", () => {
    expect(emergingNicheEvidence([100, 200, 300, 2000], 50000)).toMatch(/3 de 4/);
    expect(emergingNicheEvidence([2000, 3000, 4000], 50000)).toBeNull();
  });
});

describe("nichos y patrones", () => {
  it("elige 3 nichos distintos del catálogo de forma determinista", () => {
    const a = nichesOfTheDay(new Date("2026-11-13"));
    expect(new Set(a).size).toBe(3);
    expect(a).toEqual(nichesOfTheDay(new Date("2026-11-13T20:00:00Z")));
    a.forEach((n) => expect(NICHE_CATALOG).toContain(n));
  });
  it("calcula patrones de publicación", () => {
    const vs = [vid(100, 1, 30, "¿Por qué 5 cosas?"), vid(200, 8, 700), vid(300, 15, 700)];
    const p = computePatterns(vs);
    expect(p.analyzedVideos).toBe(3);
    expect(p.medianDaysBetweenUploads).toBe(7);
    expect(p.titles.withQuestion).toBe(1);
    expect(p.durationBuckets.find((b) => b.label === "≤ 1 min")!.count).toBe(1);
  });
});
