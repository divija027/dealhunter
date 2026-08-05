CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_attempts (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  encrypted_access_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_variants (
  variant_key TEXT PRIMARY KEY,
  product_id TEXT,
  spin_id TEXT,
  product_name TEXT NOT NULL,
  brand TEXT,
  pack_size TEXT,
  product_url TEXT,
  available INTEGER NOT NULL,
  selling_price REAL,
  mrp REAL,
  discount_pct REAL,
  qualifies INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successful_run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  available INTEGER NOT NULL,
  selling_price REAL,
  mrp REAL,
  discount_pct REAL,
  qualifies INTEGER NOT NULL,
  FOREIGN KEY (variant_key) REFERENCES product_variants(variant_key)
);

CREATE INDEX IF NOT EXISTS idx_price_observations_variant_time
  ON price_observations(variant_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS alert_states (
  variant_key TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  last_alerted_at TEXT,
  last_alerted_price REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (variant_key) REFERENCES product_variants(variant_key)
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  variant_count INTEGER NOT NULL DEFAULT 0,
  qualifying_count INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_started_at
  ON monitor_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS notification_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
