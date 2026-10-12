-- ============================================================================
-- Influence Ads AI — esquema base
-- Toda tabla con datos de un cliente lleva org_id y (cuando aplica) client_id.
-- El aislamiento se aplica en la capa de datos (src/lib/tenancy.ts): toda
-- consulta filtra por org_id y por los clientes a los que el usuario tiene acceso.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Organizaciones, usuarios y permisos ────────────────────────────────────
CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  -- Botón rojo: detiene TODA automatización de la organización.
  automation_kill_switch boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Roles: owner > admin > media_buyer > analyst > viewer (ver src/lib/permissions.ts)
CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','admin','media_buyer','analyst','viewer')),
  -- false = el usuario solo ve los clientes listados en client_access
  all_clients boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,           -- sha256 del token de la cookie; el token nunca se guarda
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);

-- ── Clientes ────────────────────────────────────────────────────────────────
CREATE TABLE clients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  industry         text,
  website          text,
  country          text NOT NULL DEFAULT 'CL',
  currency         text NOT NULL DEFAULT 'CLP',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  -- Ficha de negocio y marca (validada con zod en src/lib/schemas.ts)
  profile          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Ficha de marca sintetizada por IA a partir de los materiales (con fuentes)
  brand_summary    jsonb,
  -- Nivel de automatización: observe (1), approve (2), auto (3). Por defecto observar.
  automation_level text NOT NULL DEFAULT 'observe' CHECK (automation_level IN ('observe','approve','auto')),
  automation_paused boolean NOT NULL DEFAULT false,
  guardrails       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Recuerda las respuestas del asistente para no volver a preguntarlas
  wizard_memory    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX clients_org ON clients(org_id);

CREATE TABLE client_access (
  org_id    uuid NOT NULL,
  client_id uuid NOT NULL,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, user_id),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

-- ── Archivos (fotos, videos, logos, documentos, creatividades) ─────────────
CREATE TABLE assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  client_id    uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image','video','document','logo','creative')),
  source       text NOT NULL CHECK (source IN ('upload','ai','editor')),
  filename     text NOT NULL,
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL,
  width        int,
  height       int,
  sha256       text NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  notes        text,
  ai_prompt    text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);
CREATE INDEX assets_client ON assets(client_id, created_at DESC);

-- ── Meta: conexiones OAuth, cuentas publicitarias, páginas, Instagram ──────
CREATE TABLE oauth_states (
  state       text PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE meta_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  meta_user_id     text NOT NULL,
  meta_user_name   text,
  token_enc        text,                  -- AES-256-GCM; NULL tras revocar
  token_expires_at timestamptz,
  scopes           text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','error')),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, meta_user_id)
);

CREATE TABLE ad_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id   uuid REFERENCES meta_connections(id) ON DELETE SET NULL,
  meta_account_id text NOT NULL,          -- formato act_<id>
  name            text NOT NULL,
  currency        text,
  timezone_name   text,
  account_status  int,
  business_name   text,
  -- Una cuenta publicitaria pertenece como máximo a un cliente
  client_id       uuid,
  managed         boolean NOT NULL DEFAULT false,
  last_synced_at  timestamptz,
  sync_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, meta_account_id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE SET NULL (client_id)
);

CREATE TABLE meta_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES meta_connections(id) ON DELETE SET NULL,
  page_id       text NOT NULL,
  name          text NOT NULL,
  tasks         text[] NOT NULL DEFAULT '{}',
  client_id     uuid,
  UNIQUE (org_id, page_id),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE SET NULL (client_id)
);

-- Perfil profesional de Instagram (NO es una cuenta publicitaria)
CREATE TABLE meta_instagram_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES meta_connections(id) ON DELETE SET NULL,
  ig_user_id    text NOT NULL,
  username      text,
  page_id       text,                     -- página de Facebook vinculada
  client_id     uuid,
  UNIQUE (org_id, ig_user_id),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE SET NULL (client_id)
);

-- ── Estructura de campañas sincronizada desde Meta ─────────────────────────
CREATE TABLE meta_objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  ad_account_id    uuid NOT NULL,
  level            text NOT NULL CHECK (level IN ('campaign','adset','ad')),
  meta_id          text NOT NULL,
  parent_meta_id   text,                  -- campaña del adset / adset del anuncio
  campaign_meta_id text,
  name             text NOT NULL,
  objective        text,
  status           text,
  effective_status text,
  daily_budget     numeric,               -- en unidades de la moneda (ya convertido)
  lifetime_budget  numeric,
  optimization_goal text,
  bid_strategy     text,
  creative         jsonb,                 -- título, texto, miniatura, cta (solo anuncios)
  created_time     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, level, meta_id),
  FOREIGN KEY (org_id, ad_account_id) REFERENCES ad_accounts(org_id, id) ON DELETE CASCADE
);
CREATE INDEX meta_objects_campaign ON meta_objects(ad_account_id, campaign_meta_id);

-- Métricas diarias. reach y frequency NO son sumables entre días: el alcance
-- de un periodo se guarda en insights_period.
CREATE TABLE insights_daily (
  org_id           uuid NOT NULL,
  ad_account_id    uuid NOT NULL,
  -- Se guarda a nivel de anuncio; campaña/conjunto/cuenta se obtienen sumando
  -- (solo métricas aditivas).
  level            text NOT NULL DEFAULT 'ad' CHECK (level IN ('ad')),
  object_id        text NOT NULL,
  campaign_meta_id text,
  adset_meta_id    text,
  date             date NOT NULL,
  spend            numeric NOT NULL DEFAULT 0,
  impressions      bigint NOT NULL DEFAULT 0,
  clicks           bigint NOT NULL DEFAULT 0,
  link_clicks      bigint NOT NULL DEFAULT 0,
  leads            numeric NOT NULL DEFAULT 0,
  purchases        numeric NOT NULL DEFAULT 0,
  purchase_value   numeric NOT NULL DEFAULT 0,
  messaging_conversations numeric NOT NULL DEFAULT 0,
  actions          jsonb,
  attribution_setting text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_account_id, level, object_id, date),
  FOREIGN KEY (org_id, ad_account_id) REFERENCES ad_accounts(org_id, id) ON DELETE CASCADE
);
CREATE INDEX insights_daily_date ON insights_daily(ad_account_id, date);
CREATE INDEX insights_daily_campaign ON insights_daily(ad_account_id, campaign_meta_id, date);

CREATE TABLE insights_period (
  org_id        uuid NOT NULL,
  ad_account_id uuid NOT NULL,
  level         text NOT NULL,
  object_id     text NOT NULL,
  date_start    date NOT NULL,
  date_stop     date NOT NULL,
  reach         bigint,
  frequency     numeric,
  impressions   bigint,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_account_id, level, object_id, date_start, date_stop),
  FOREIGN KEY (org_id, ad_account_id) REFERENCES ad_accounts(org_id, id) ON DELETE CASCADE
);

-- ── Trabajos en segundo plano ──────────────────────────────────────────────
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  run_after   timestamptz NOT NULL DEFAULT now(),
  attempts    int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error  text,
  dedupe_key  text,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_pick ON jobs(status, run_after);
CREATE UNIQUE INDEX jobs_dedupe ON jobs(dedupe_key) WHERE status IN ('queued','running');

-- ── Laboratorio creativo ───────────────────────────────────────────────────
CREATE TABLE campaign_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  client_id     uuid NOT NULL,
  ad_account_id uuid,
  name          text NOT NULL,
  objective     text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ready','publishing','published_paused','active','failed','discarded')),
  input         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- respuestas del asistente
  strategy      jsonb,                                -- razonamiento de marketing (IA)
  structure     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- presupuesto, audiencia, destino, página
  validation    jsonb,                                -- último checklist de validación
  meta_ids      jsonb,                                -- ids creados en Meta
  publish_error text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

CREATE TABLE creative_concepts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  client_id    uuid NOT NULL,
  draft_id     uuid REFERENCES campaign_drafts(id) ON DELETE SET NULL,
  angle        text NOT NULL,       -- problema_solucion, beneficio, demostracion, ...
  title        text NOT NULL,
  hypothesis   text NOT NULL,
  hook         text NOT NULL,
  value_prop   text NOT NULL,
  visual_idea  text NOT NULL,
  visual_source text NOT NULL DEFAULT 'foto_real' CHECK (visual_source IN ('foto_real','ia_permitida')),
  cta          text NOT NULL,
  audience     text NOT NULL,
  objection    text,
  copy         jsonb NOT NULL,      -- textos, variantes, guion, texto en pantalla
  needs_verification text[] NOT NULL DEFAULT '{}', -- afirmaciones que el usuario debe confirmar
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','discarded')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);
CREATE INDEX concepts_client ON creative_concepts(client_id, created_at DESC);

CREATE TABLE creatives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  client_id       uuid NOT NULL,
  concept_id      uuid REFERENCES creative_concepts(id) ON DELETE SET NULL,
  format          text NOT NULL CHECK (format IN ('feed_4x5','feed_1x1','feed_4x3','vertical_9x16')),
  with_text       boolean NOT NULL DEFAULT true,
  background_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  output_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  layout          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- estado del editor
  checks          jsonb,                               -- verificación técnica del archivo
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

-- ── Diagnóstico, aprendizaje y experimentos ────────────────────────────────
CREATE TABLE diagnoses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  client_id     uuid NOT NULL,
  trigger       text NOT NULL CHECK (trigger IN ('manual','scheduled')),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  findings      jsonb NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

CREATE TABLE experiments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  client_id          uuid NOT NULL,
  ad_account_id      uuid,
  draft_id           uuid REFERENCES campaign_drafts(id) ON DELETE SET NULL,
  name               text NOT NULL,
  objective          text NOT NULL,
  hypothesis         text NOT NULL,
  primary_metric     text NOT NULL,      -- cpa | cpl | roas | ctr | qualified_cpl ...
  audience           jsonb,
  creative_ref       jsonb,              -- concepto/creatividad/copy usados
  meta_refs          jsonb,              -- ids de campaña/conjunto/anuncios en Meta
  budget             numeric,
  attribution_setting text,
  launched_at        timestamptz,
  review_at          timestamptz,
  status             text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','concluded','cancelled')),
  result             jsonb,              -- métricas observadas al cierre
  decision           text,
  outcome            text,               -- lo que pasó después de la decisión
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  concluded_at       timestamptz,
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

CREATE TABLE learnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  client_id     uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('observado','hipotesis','conclusion')),
  statement     text NOT NULL,
  evidence      jsonb,
  confidence    text CHECK (confidence IN ('baja','media','alta')),
  experiment_id uuid REFERENCES experiments(id) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

-- ── Motor de decisiones ────────────────────────────────────────────────────
CREATE TABLE proposed_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  client_id       uuid NOT NULL,
  ad_account_id   uuid,
  type            text NOT NULL CHECK (type IN ('pause','resume','budget_change','new_creative','review_tracking','review_landing','review_offer','review_audience')),
  target_level    text CHECK (target_level IN ('campaign','adset','ad')),
  target_meta_id  text,
  target_name     text,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  title           text NOT NULL,
  rationale       text NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence      text NOT NULL CHECK (confidence IN ('baja','media','alta')),
  expected_effect text,
  review_after    timestamptz,
  status          text NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','approved','rejected','executing','executed','failed','blocked','expired')),
  blocked_reason  text,
  executable      boolean NOT NULL DEFAULT false, -- se puede ejecutar vía API
  dedupe_key      text NOT NULL,
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  executed_at     timestamptz,
  executed_by     text,                            -- 'user:<id>' | 'automation'
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);
CREATE INDEX actions_client ON proposed_actions(client_id, created_at DESC);
CREATE UNIQUE INDEX actions_open_dedupe ON proposed_actions(dedupe_key) WHERE status IN ('proposed','approved','executing');

-- ── Ventas reales y calidad de leads ───────────────────────────────────────
CREATE TABLE conversions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  client_id        uuid NOT NULL,
  source           text NOT NULL CHECK (source IN ('manual','whatsapp','crm','ecommerce','web')),
  kind             text NOT NULL CHECK (kind IN ('conversation','lead','qualified_lead','sale')),
  external_id      text NOT NULL,        -- id en el sistema de origen (evita duplicados)
  occurred_at      timestamptz NOT NULL,
  value            numeric,
  margin           numeric,
  currency         text,
  campaign_meta_id text,
  adset_meta_id    text,
  ad_meta_id       text,
  utm              jsonb,
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, external_id, kind),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);
CREATE INDEX conversions_client_date ON conversions(client_id, occurred_at);

CREATE TABLE inbound_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  client_id   uuid NOT NULL,
  name        text NOT NULL,
  source      text NOT NULL CHECK (source IN ('crm','ecommerce','web','whatsapp')),
  secret_enc  text NOT NULL,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id) ON DELETE CASCADE
);

-- ── Auditoría (solo inserción) ─────────────────────────────────────────────
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL,
  client_id   uuid,
  user_id     uuid,
  actor       text NOT NULL CHECK (actor IN ('user','system','automation')),
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_date ON audit_log(org_id, created_at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es solo de inserción';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
