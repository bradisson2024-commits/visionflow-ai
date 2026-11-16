-- EL PRECIO OCULTO VIRAL FINDER · esquema de base de datos (SQLite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS searches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  language     TEXT NOT NULL,
  period_days  INTEGER NOT NULL,
  min_minutes  INTEGER NOT NULL DEFAULT 4,
  result_count INTEGER NOT NULL DEFAULT 0,
  quota_used   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok',
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,           -- id de YouTube
  title         TEXT NOT NULL,
  description   TEXT,
  channel_id    TEXT,
  channel_title TEXT,
  subscribers   INTEGER,
  published_at  TEXT,
  duration_sec  INTEGER,
  views         INTEGER,
  likes         INTEGER,
  comments      INTEGER,
  thumbnail     TEXT,
  language      TEXT,
  tags          TEXT,                        -- JSON
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_results (
  search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  video_id  TEXT NOT NULL REFERENCES videos(id),
  rank      INTEGER NOT NULL,
  PRIMARY KEY (search_id, video_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  video_id    TEXT NOT NULL REFERENCES videos(id),
  search_id   INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  level       TEXT NOT NULL,                 -- alta | media | baja
  metrics     TEXT NOT NULL,                 -- JSON con las cifras usadas
  reasons     TEXT NOT NULL,                 -- JSON [string]
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (video_id, search_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  source_video  TEXT REFERENCES videos(id),
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'borrador', -- borrador | en_produccion | necesita_accion | error | terminado
  stage         TEXT NOT NULL DEFAULT 'analisis',
  image_engine  TEXT NOT NULL DEFAULT 'gemini',   -- gemini | flow
  transcript    TEXT,
  transcript_source TEXT,
  analysis      TEXT,   -- JSON
  proposal      TEXT,   -- JSON (versión mejorada + fuentes)
  script        TEXT,   -- JSON
  render        TEXT,   -- JSON (línea de tiempo, música)
  verification  TEXT,   -- JSON
  deliverables  TEXT,   -- JSON
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | hecho | error | accion
  message    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS scenes (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  n              INTEGER NOT NULL,
  part           TEXT,
  narration      TEXT NOT NULL,
  sources        TEXT,           -- JSON [n]
  visual         TEXT,           -- qué debe verse (español)
  image_prompt   TEXT,           -- prompt para el generador
  sfx            TEXT,
  image_file     TEXT,
  image_hash     TEXT,
  image_engine   TEXT,
  image_requested_at TEXT,
  review         TEXT,           -- JSON
  audio_file     TEXT,
  audio_sec      REAL,
  audio_text_hash TEXT,
  PRIMARY KEY (project_id, n)
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  payload     TEXT,
  state       TEXT NOT NULL DEFAULT 'en_cola', -- en_cola | en_curso | hecho | error | cancelado
  progress    REAL NOT NULL DEFAULT 0,
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service    TEXT NOT NULL,
  operation  TEXT NOT NULL,
  units      INTEGER NOT NULL DEFAULT 0,
  ok         INTEGER NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, id);
CREATE INDEX IF NOT EXISTS idx_api_log_day ON api_log(service, created_at);
