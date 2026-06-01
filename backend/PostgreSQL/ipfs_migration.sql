-- IPFS support for property images and NFT metadata.
-- Run this once in pgAdmin/psql if the database already existed before IPFS was added.

CREATE TABLE IF NOT EXISTS property_images (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  image_cid TEXT NOT NULL CHECK (BTRIM(image_cid) <> ''),
  image_uri TEXT NOT NULL CHECK (BTRIM(image_uri) <> ''),
  gateway_url TEXT NOT NULL CHECK (BTRIM(gateway_url) <> ''),
  mime_type TEXT NOT NULL CHECK (BTRIM(mime_type) <> ''),
  original_name TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  uploaded_by_user_id BIGINT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property
  ON property_images(property_id, sort_order, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_images_property_cid
  ON property_images(property_id, image_cid);

CREATE INDEX IF NOT EXISTS idx_property_images_uploaded_by
  ON property_images(uploaded_by_user_id, created_at DESC);
