-- ---------------------------------------------------------------------------
-- AI Automation Platform - the whole database, in one file.
-- Run it with:  npm run migrate     (it is safe to run repeatedly)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --- the drawings ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  active      boolean NOT NULL DEFAULT false,
  nodes       jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(nodes) = 'array'),
  connections jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(connections) = 'object'),
  version     integer NOT NULL DEFAULT 1,        -- bumped on every save; stops silent overwrites
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --- every past run --------------------------------------------------------
CREATE TABLE IF NOT EXISTS executions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  mode        text NOT NULL DEFAULT 'manual'
              CHECK (mode IN ('manual','webhook','schedule')),
  status      text NOT NULL CHECK (status IN ('running','success','error','cancelled')),
  data        jsonb,                              -- what each node produced
  log         jsonb NOT NULL DEFAULT '[]',        -- the receipt from the engine
  error       jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- the executions list is the most-hit query in the whole product: index it now
CREATE INDEX IF NOT EXISTS executions_by_workflow
  ON executions (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS executions_running
  ON executions (status) WHERE status = 'running';

-- keep updated_at honest without every route remembering to set it
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); NEW.version = OLD.version + 1; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workflows_touch ON workflows;
CREATE TRIGGER workflows_touch BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- --- the addresses strangers can reach -------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
  path          text NOT NULL CHECK (path ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  method        text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  workflow_id   uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_name     text NOT NULL,
  is_test       boolean NOT NULL DEFAULT false,
  response_mode text NOT NULL DEFAULT 'lastNode'
                CHECK (response_mode IN ('immediately','lastNode')),
  secret        jsonb,                       -- optional shared secret, encrypted envelope
  PRIMARY KEY (path, method, is_test)        -- two workflows cannot claim one address
);

-- --- the timers ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
  node_name   text NOT NULL DEFAULT 'Schedule',
  cron        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Australia/Sydney'
);

-- a webhook delivered twice must not do the work twice
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  idempotency_key text PRIMARY KEY,
  execution_id    uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  received_at     timestamptz NOT NULL DEFAULT now()
);

-- --- the keys, never in plain text -----------------------------------------
CREATE TABLE IF NOT EXISTS credentials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  type       text NOT NULL,                 -- googleSheets | googleDrive | googleDocs | gmail | anthropicApi
  data       jsonb,                         -- the ENCRYPTED envelope, never plain tokens
  scopes     text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,                   -- when the short-lived access token dies
  created_at timestamptz NOT NULL DEFAULT now()
);

-- a one-use, short-lived note proving the browser that comes back is the one we sent
CREATE TABLE IF NOT EXISTS oauth_states (
  state         text PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL
);
