-- ViralHunter AI — esquema inicial (PostgreSQL / Supabase)
create extension if not exists pgcrypto;

-- Consumo de cuota de YouTube Data API por día (Pacific Time, como Google)
create table if not exists yt_quota_usage (
  day date primary key,
  units integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Búsquedas ejecutadas (recientes o por nicho)
create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('recent','niche')),
  params jsonb not null default '{}'::jsonb,
  niches jsonb not null default '[]'::jsonb,
  status text not null default 'running' check (status in ('running','done','error')),
  error text,
  quota_units integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Caché de canales de YouTube (datos públicos oficiales)
create table if not exists channels (
  id text primary key,                 -- UC...
  title text not null,
  description text,
  custom_url text,
  thumbnail_url text,
  country text,
  default_language text,
  published_at timestamptz,
  subscriber_count bigint,
  subscribers_hidden boolean not null default false,
  view_count bigint,
  video_count integer,
  uploads_playlist_id text,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

-- Resultado clasificado de un canal dentro de una búsqueda
create table if not exists search_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references searches(id) on delete cascade,
  channel_id text not null references channels(id),
  rank integer not null,
  score integer not null,
  score_breakdown jsonb not null,
  niche text,
  language text,
  language_source text,
  tags jsonb not null default '[]'::jsonb,
  featured_videos jsonb not null default '[]'::jsonb,
  revenue_estimate jsonb,
  ai_insights jsonb,
  created_at timestamptz not null default now()
);
create index if not exists search_results_search_idx on search_results(search_id, rank);

-- Proyectos ReplicaPro
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  source_channel_id text references channels(id),
  source_url text not null,
  stage integer not null default 1 check (stage between 1 and 4),
  channel_analysis jsonb,
  style_analysis jsonb,
  style_choices jsonb,
  style_approved boolean not null default false,
  branding_proposals jsonb,
  branding_selected jsonb,
  branding_approved boolean not null default false,
  video_proposals jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recursos generados (imágenes / audios) por proveedores reales
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  kind text not null,                 -- style_ref | character | logo | banner | thumbnail | voice_sample
  provider text not null,             -- openai | elevenlabs
  model text,
  prompt text,
  mime_type text not null,
  data bytea not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assets_project_idx on assets(project_id, kind);

-- Configuración de la app (preferencias no secretas)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seguridad Supabase: el acceso se hace sólo desde el servidor (rol postgres/service).
alter table yt_quota_usage enable row level security;
alter table searches enable row level security;
alter table channels enable row level security;
alter table search_results enable row level security;
alter table projects enable row level security;
alter table assets enable row level security;
alter table settings enable row level security;
