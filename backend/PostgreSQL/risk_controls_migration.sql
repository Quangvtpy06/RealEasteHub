-- Risk control columns for admin platform moderation.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by_user_id BIGINT REFERENCES app_users(id);

ALTER TABLE property
  ADD COLUMN IF NOT EXISTS risk_status TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS risk_reason TEXT,
  ADD COLUMN IF NOT EXISTS risk_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS risk_flagged_by_user_id BIGINT REFERENCES app_users(id);

CREATE INDEX IF NOT EXISTS idx_property_risk_status
  ON property(risk_status, active, updated_at DESC);
