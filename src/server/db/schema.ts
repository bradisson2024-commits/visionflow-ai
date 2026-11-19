/**
 * Esquema de base de datos de ClipForge AI.
 *
 * Está diseñado desde la Fase 1 para todo el flujo (proyecto → video →
 * trabajo de análisis → transcripción → clips → renderizado/exportación),
 * de modo que las fases siguientes no requieran rehacer el modelo.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ───────────────────────────── Usuarios ───────────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 del token de sesión. El token en claro sólo vive en la cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ───────────────────────────── Proyectos ──────────────────────────── */

export const projectStatus = pgEnum("project_status", [
  "draft", // creado, sin video
  "uploading", // video subiendo
  "uploaded", // video cargado
  "queued", // en cola para análisis
  "processing", // analizando (ver jobs.stage para el detalle)
  "ready", // clips sugeridos disponibles
  "error",
]);

/** Preferencias de generación que el usuario elige al crear/analizar. */
export type ProjectSettings = {
  clipLength?: { preset: "short" | "medium" | "long" | "custom"; minSec: number; maxSec: number };
  aspectRatio?: AspectRatio;
  captionStyle?: string;
  language?: string; // código ISO o "auto"
  maxClips?: number;
};

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: projectStatus("status").notNull().default("draft"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

/* ───────────────────────────── Videos ─────────────────────────────── */

export const uploadStatus = pgEnum("upload_status", ["uploading", "uploaded", "failed", "cancelled"]);

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    /** Origen: subida directa o enlace importado. */
    source: text("source").$type<"upload" | "url">().notNull().default("upload"),
    sourceUrl: text("source_url"),
    error: text("error"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    receivedBytes: bigint("received_bytes", { mode: "number" }).notNull().default(0),
    uploadStatus: uploadStatus("upload_status").notNull().default("uploading"),
    durationSec: real("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    fps: real("fps"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    thumbnailKey: text("thumbnail_key"),
    ...timestamps,
  },
  (t) => [index("videos_project_idx").on(t.projectId)],
);

/* ──────────────────────── Trabajos en segundo plano ───────────────── */

export const jobType = pgEnum("job_type", ["import_url", "analyze", "render_clip", "export_zip"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed", "cancelled"]);
/** Etapas visibles para el usuario (requisito §12). */
export const jobStage = pgEnum("job_stage", [
  "queued",
  "downloading",
  "probing",
  "extracting_audio",
  "transcribing",
  "detecting_moments",
  "generating_clips",
  "rendering",
  "completed",
  "error",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "cascade" }),
    clipId: uuid("clip_id"),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    stage: jobStage("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0), // 0..100
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("jobs_project_idx").on(t.projectId, t.createdAt)],
);

/* ───────────────────────────── Transcripción ──────────────────────── */

export type TranscriptWord = { w: string; s: number; e: number; p?: number };
export type TranscriptSegment = { id: number; s: number; e: number; text: string; speaker?: string };

export const transcripts = pgTable("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id")
    .notNull()
    .unique()
    .references(() => videos.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model"),
  language: text("language"),
  text: text("text").notNull(),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull(),
  words: jsonb("words").$type<TranscriptWord[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────────── Clips ──────────────────────────────── */

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export type ClipScoreBreakdown = {
  hook: number;
  topicInterest: number;
  curiosity: number;
  emotion: number;
  clarity: number;
  standalone: number;
  retention: number;
  ending: number;
  socialPotential: number;
};

export type CaptionStyle = {
  preset: string;
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  color: string;
  highlightColor: string;
  backgroundColor: string | null;
  outlineColor: string | null;
  outlineWidth: number;
  position: "top" | "middle" | "bottom";
  highlightMode: "none" | "word" | "karaoke";
  uppercase: boolean;
  wordsPerLine: number;
};

export type ClipEdit = {
  aspectRatio: AspectRatio;
  reframe: "auto" | "center" | "manual";
  /** Centro del recorte manual, 0..1 relativo al ancho/alto de la fuente. */
  manualFocus?: { x: number; y: number };
  zoom?: number;
  volume?: number;
  captions: CaptionStyle;
};

export const clipStatus = pgEnum("clip_status", ["suggested", "queued", "rendering", "ready", "failed"]);

export const clips = pgTable(
  "clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    topic: text("topic"),
    startSec: real("start_sec").notNull(),
    endSec: real("end_sec").notNull(),
    transcript: text("transcript").notNull(),
    reason: text("reason"),
    hook: text("hook"),
    score: integer("score"),
    scoreBreakdown: jsonb("score_breakdown").$type<ClipScoreBreakdown>(),
    /** Palabras editadas por el usuario (si null se usan las de la transcripción). */
    captionWords: jsonb("caption_words").$type<TranscriptWord[]>(),
    edit: jsonb("edit").$type<ClipEdit>(),
    status: clipStatus("status").notNull().default("suggested"),
    outputKey: text("output_key"),
    subtitleKey: text("subtitle_key"),
    thumbnailKey: text("thumbnail_key"),
    renderedAt: timestamp("rendered_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("clips_project_idx").on(t.projectId, t.position)],
);

/* ───────────────────────────── Relaciones ─────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({ projects: many(projects) }));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  videos: many(videos),
  clips: many(clips),
  jobs: many(jobs),
}));
export const videosRelations = relations(videos, ({ one }) => ({
  project: one(projects, { fields: [videos.projectId], references: [projects.id] }),
  transcript: one(transcripts, { fields: [videos.id], references: [transcripts.videoId] }),
}));
export const clipsRelations = relations(clips, ({ one }) => ({
  project: one(projects, { fields: [clips.projectId], references: [projects.id] }),
  video: one(videos, { fields: [clips.videoId], references: [videos.id] }),
}));
export const jobsRelations = relations(jobs, ({ one }) => ({
  project: one(projects, { fields: [jobs.projectId], references: [projects.id] }),
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Clip = typeof clips.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
