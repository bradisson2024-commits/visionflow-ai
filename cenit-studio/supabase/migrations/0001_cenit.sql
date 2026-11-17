-- Cenit Studio · esquema inicial (PostgreSQL / Supabase)
-- Los usuarios autenticados con Supabase Auth se reflejan en app_users con el mismo id (claim "sub" del JWT).

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text,                       -- sólo en modo local (sin Supabase)
  display_name  text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references app_users(id) on delete cascade,
  delta      integer not null,              -- positivo = recarga, negativo = consumo
  operation  text not null,                 -- p. ej. image.generate, tts, video.animate
  detail     jsonb not null default '{}',
  project_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user on credit_ledger(user_id, created_at desc);

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Estilos visuales: perfiles reales que usa el generador (ampliables por el usuario).
create table if not exists styles (
  id          text primary key,
  name        text not null,
  description text not null,
  profile     jsonb not null,               -- prompt base, paleta, cámara, iluminación, negativos
  sample_path text,
  builtin     boolean not null default false,
  owner_id    uuid references app_users(id) on delete cascade,
  sort        integer not null default 100,
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references app_users(id) on delete cascade,
  title        text not null,
  mode         text not null check (mode in ('guion','idea','url','audio')),
  format       text not null check (format in ('9:16','16:9','1:1')),
  style_id     text not null references styles(id),
  template     text,
  idea         text,
  script       text,
  rhythm       jsonb not null default '{"preset":"normal","seconds":5}',
  source       jsonb,                       -- URL / audio de origen y su análisis
  bible        jsonb,                       -- continuidad: época, lugares, luz y personajes recurrentes
  voice        jsonb not null default '{}',
  subtitles    jsonb not null default '{}',
  music        jsonb not null default '{}',
  edit         jsonb not null default '{}',
  status       text not null default 'borrador',
  export_path  text,
  export_meta  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists projects_owner on projects(owner_id, updated_at desc);

create table if not exists characters (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null default 'personaje', -- personaje | animal | objeto | escenario
  name        text not null,
  role        text,
  description text,
  wardrobe    text,
  traits      text,
  ref_path    text,
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists scenes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  idx           integer not null,
  narration     text not null,
  visual        text,
  image_prompt  text,
  anim_prompt   text,
  character_ids uuid[] not null default '{}',
  image_path    text,
  image_status  text not null default 'pendiente', -- pendiente | en_cola | generando | lista | error
  image_error   text,
  anim_mode     text not null default 'ninguna',   -- ninguna | camara | veo
  anim_path     text,
  anim_status   text not null default 'pendiente',
  anim_error    text,
  audio_path    text,
  audio_sec     real,
  audio_status  text not null default 'pendiente',
  audio_error   text,
  duration_sec  real,
  transition    text not null default 'fundido',
  subtitle      text,
  unique (project_id, idx) deferrable initially deferred
);

create table if not exists music_tracks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references app_users(id) on delete cascade, -- null = biblioteca común
  kind       text not null check (kind in ('musica','efecto')),
  title      text not null,
  mood       text,
  path       text not null,
  duration   real,
  license    text not null,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id          bigserial primary key,
  owner_id    uuid references app_users(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'en_cola',   -- en_cola | en_curso | hecho | error | cancelado
  progress    real not null default 0,
  message     text,
  attempts    integer not null default 0,
  run_at      timestamptz not null default now(),
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists jobs_queue on jobs(status, run_at);

-- ---------------------------------------------------------------- YouTube
create table if not exists yt_channels (
  id               text primary key,
  title            text,
  handle           text,
  description      text,
  thumbnail        text,
  country          text,
  default_language text,
  created_at_yt    timestamptz,               -- snippet.publishedAt: fecha de creación según YouTube
  subscribers      bigint,
  subscribers_hidden boolean,
  views            bigint,
  video_count      integer,
  uploads_playlist text,
  fetched_at       timestamptz not null default now()
);

create table if not exists yt_videos (
  id            text primary key,
  channel_id    text,
  title         text,
  description   text,
  thumbnail     text,
  published_at  timestamptz,
  duration_sec  integer,
  is_short      boolean,
  language      text,
  views         bigint,
  likes         bigint,
  comments      bigint,
  paid_placement boolean,
  fetched_at    timestamptz not null default now()
);
create index if not exists yt_videos_channel on yt_videos(channel_id, published_at desc);

-- Capturas sucesivas: la velocidad de crecimiento se mide con dos o más.
create table if not exists yt_video_snapshots (
  video_id text not null,
  taken_at timestamptz not null default now(),
  views    bigint, likes bigint, comments bigint,
  primary key (video_id, taken_at)
);
create table if not exists yt_channel_snapshots (
  channel_id  text not null,
  taken_at    timestamptz not null default now(),
  subscribers bigint, views bigint, video_count integer,
  primary key (channel_id, taken_at)
);

create table if not exists radar_searches (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references app_users(id) on delete cascade,
  kind       text not null check (kind in ('viral','canales','canal')),
  filters    jsonb not null,
  thresholds jsonb not null,
  quota_used integer not null default 0,
  status     text not null default 'ok',
  error      text,
  created_at timestamptz not null default now()
);
create table if not exists radar_items (
  search_id   uuid not null references radar_searches(id) on delete cascade,
  item_type   text not null check (item_type in ('video','canal')),
  item_id     text not null,
  score       real not null,
  categories  text[] not null default '{}',
  monetization text,                          -- confirmada | senales | potencial | sin_datos
  evidence    jsonb not null default '{}',
  explanation jsonb not null default '[]',
  primary key (search_id, item_type, item_id)
);

-- Evidencia manual de monetización confirmada (grupo A), con fuente.
create table if not exists monetization_evidence (
  channel_id text not null,
  owner_id   uuid not null references app_users(id) on delete cascade,
  source_url text not null,
  note       text not null,
  created_at timestamptz not null default now(),
  primary key (channel_id, owner_id)
);

create table if not exists weekly_research (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references app_users(id) on delete cascade,
  name        text not null,
  config      jsonb not null,               -- nichos, idiomas, países, umbrales
  weekday     integer not null default 1,   -- 0 domingo … 6 sábado
  hour        integer not null default 9,
  enabled     boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at  timestamptz not null default now()
);
create table if not exists weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  research_id uuid not null references weekly_research(id) on delete cascade,
  created_at  timestamptz not null default now(),
  summary     jsonb not null,
  items       jsonb not null
);
create table if not exists weekly_seen (
  research_id uuid not null references weekly_research(id) on delete cascade,
  item_type   text not null,
  item_id     text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (research_id, item_type, item_id)
);

create table if not exists api_calls (
  id        bigserial primary key,
  service   text not null,
  operation text not null,
  units     integer not null default 0,
  ok        boolean not null,
  detail    text,
  at        timestamptz not null default now()
);
create index if not exists api_calls_service on api_calls(service, at desc);
