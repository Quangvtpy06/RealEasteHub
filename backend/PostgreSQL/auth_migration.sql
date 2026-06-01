-- Authentication and role-based authorization tables.
-- Run this once in pgAdmin or psql if your existing database was created before auth was added.

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL CHECK (BTRIM(username) <> ''),
  password_hash TEXT NOT NULL CHECK (BTRIM(password_hash) <> ''),
  display_name TEXT NOT NULL CHECK (BTRIM(display_name) <> ''),
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  profile_id BIGINT REFERENCES profiles(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username
  ON app_users(LOWER(username));

CREATE INDEX IF NOT EXISTS idx_app_users_role_active
  ON app_users(role, active);

CREATE INDEX IF NOT EXISTS idx_app_users_profile
  ON app_users(profile_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

SELECT id, username, role, active
FROM app_users;

DELETE FROM profiles
WHERE username = 'admin';
--
SELECT *
FROM profiles;
--
DELETE
FROM profiles
WHERE wallet_address = '0x822Ca97759AF6CB44a48474C97DbE7983424DF31';
