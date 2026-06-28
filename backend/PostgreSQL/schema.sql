-- Lưu trữ Database vói Postgres
/*Dùng IF NOT EXISTS để tránh trùng lặp dữ liệu*/ 
/*Tạo bảng properties lưu trữ thông tin của người truy cập*/
CREATE TABLE IF NOT EXISTS profiles (
  ID BIGSERIAL PRIMARY KEY,
  --lưu dữ liệu chi tiết từ SC không bị trùng lặp
  backend_person_id TEXT NOT NULL UNIQUE,
  backend_person_hash TEXT NOT NULL UNIQUE,
  --thông tin về người đăng nhập
  -- các thông tin về địa chỉ ví, name, country, cccd, phone không được để trống
  wallet_address TEXT NOT NULL CHECK (BTRIM(wallet_address) <> ''),
  full_name TEXT NOT NULL CHECK (BTRIM(full_name) <> ''),
  country text NOT NULL CHECK (BTRIM(country) <> ''),
  identify_id NUMERIC(78,0) NOT NULL CHECK (identify_id>0),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL CHECK (BTRIM(phone) <> ''),
  address TEXT NOT NULL DEFAULT '',
  profile_data_hash TEXT NOT NULL,
  --xác thực thông tin
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  registry_tx_hash TEXT,
  --ngày tạo, ngày đóng
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tạo index để truy vấn thông tin nhanh hơn cho profiles
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_wallet ON profiles(LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_profiles_verified ON profiles(verified);

-- App login accounts for frontend/backend authorization.
CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL CHECK (BTRIM(username) <> ''),
  password_hash TEXT NOT NULL CHECK (BTRIM(password_hash) <> ''),
  display_name TEXT NOT NULL CHECK (BTRIM(display_name) <> ''),
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  profile_id BIGINT REFERENCES profiles(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  suspension_reason TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_by_user_id BIGINT REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username
  ON app_users(LOWER(username));

CREATE INDEX IF NOT EXISTS idx_app_users_role_active
  ON app_users(role, active);

CREATE INDEX IF NOT EXISTS idx_app_users_profile
  ON app_users(profile_id);


--Tạo bảng lưu data tài sản
CREATE TABLE IF NOT EXISTS property (
  id BIGSERIAL PRIMARY KEY,
  backend_property_id TEXT NOT NULL UNIQUE,
  backend_property_hash TEXT NOT NULL UNIQUE,
  sc_property_id NUMERIC(78, 0) UNIQUE,
  certificate_token_id NUMERIC(78, 0) UNIQUE,
  --nếu id người sở hữu trống thì lấy sang id profiles
  owner_profile_id BIGINT NOT NULL REFERENCES profiles(id),
  owner_wallet_address TEXT NOT NULL CHECK (BTRIM(owner_wallet_address) <> ''),
  location TEXT NOT NULL CHECK (BTRIM(location) <> ''),
  property_data_hash TEXT NOT NULL,
  legal_document_hash TEXT NOT NULL,
  area_m2 NUMERIC(18, 2) NOT NULL DEFAULT 0,
  rooms NUMERIC(18, 0) NOT NULL DEFAULT 0,
  valuation_report_hash TEXT DEFAULT '',
  valuation_report_uri TEXT DEFAULT '',
  certificate_uri TEXT NOT NULL CHECK (BTRIM(certificate_uri) <> ''),
  asking_price_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
  listing_status TEXT NOT NULL DEFAULT 'unlisted'
    CHECK (listing_status IN ('unlisted', 'listed', 'sold', 'cancelled')),
  listing_sale_id NUMERIC(78, 0),
  listing_tx_hash TEXT,
  listed_at TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  risk_status TEXT NOT NULL DEFAULT 'clear',
  risk_reason TEXT,
  risk_flagged_at TIMESTAMPTZ,
  risk_flagged_by_user_id BIGINT REFERENCES app_users(id),
  registry_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--tạo index cho property
CREATE INDEX IF NOT EXISTS idx_property_owner_profile ON property(owner_profile_id);
	
CREATE INDEX IF NOT EXISTS idx_property_owner_wallet ON property(LOWER(owner_wallet_address)); 
	--dùng hàm lower để đưa address về dạng chữ thường

CREATE INDEX IF NOT EXISTS idx_property_listing_status
	ON property(listing_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_smartcontract_id --propertyid trong sc
	ON property(sc_property_id);

CREATE INDEX IF NOT EXISTS idx_property_certificate_token ON property(certificate_token_id);

CREATE INDEX IF NOT EXISTS idx_property_active_updated ON property(active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_risk_status
  ON property(risk_status, active, updated_at DESC);

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


--tạo bảng chứng nhận giao dịch
CREATE TABLE IF NOT EXISTS transfer_contract (
  id BIGSERIAL PRIMARY KEY,
  backend_transaction_id TEXT NOT NULL UNIQUE,
  backend_transaction_hash TEXT NOT NULL UNIQUE,
  sc_sale_id NUMERIC(78, 0) UNIQUE,
  property_id BIGINT NOT NULL REFERENCES property(id),
  sc_property_id NUMERIC(78, 0) NOT NULL,
  certificate_token_id NUMERIC(78, 0) NOT NULL,
  seller_profile_id BIGINT NOT NULL REFERENCES profiles (id),
  buyer_profile_id BIGINT NOT NULL REFERENCES profiles (id),
  seller_wallet_address TEXT NOT NULL,
  buyer_wallet_address TEXT NOT NULL,
  price_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
  document_hash TEXT NOT NULL,
  seller_acceptance_message TEXT,
  seller_signature TEXT,
  seller_signed_at TIMESTAMPTZ,
  fee_wei NUMERIC(78, 0),
  /*tạo trạng thái giao dịch theo 4 giai đoạn: 
  tạo giao dịch - gửi vào hệ thống kiểm tra - xác nhận hợp lệ và chuyển đi - hủy bỏ giao dịch*/
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'deposited', 'released', 'cancelled')),
  create_tx_hash TEXT,
  deposit_tx_hash TEXT,
  release_tx_hash TEXT,
  cancel_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deposited_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--tạo index cho transfer lease (hợp đồng chuyển nhượng tài sản)
CREATE INDEX IF NOT EXISTS idx_transfer_contract_property ON transfer_contract(property_id);

CREATE INDEX IF NOT EXISTS idx_transfer_contract_sc_property ON transfer_contract(sc_property_id);

CREATE INDEX IF NOT EXISTS idx_transfer_contract_seller_profile ON transfer_contract(seller_profile_id);

CREATE INDEX IF NOT EXISTS idx_transfer_contract_buyer_profile ON transfer_contract(buyer_profile_id);

CREATE INDEX IF NOT EXISTS idx_transfer_contract_seller_wallet ON transfer_contract(LOWER(seller_wallet_address));

CREATE INDEX IF NOT EXISTS idx_transfer_contract_buyer_wallet ON transfer_contract(LOWER(buyer_wallet_address));

CREATE INDEX IF NOT EXISTS idx_transfer_contract_status_updated ON transfer_contract(status, updated_at DESC);

--hệ thống chống giao dịch trùng tài sản
--tạo index truy vấn theo điều kiện
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_contract_one_active_per_property
  ON transfer_contract (property_id)
  WHERE status IN ('created', 'deposited');

--tạo bảng ghi lại lịch sử sở hữu tài sản
CREATE TABLE IF NOT EXISTS property_ownership_history (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES property(id),
  sc_property_id NUMERIC(78, 0) NOT NULL,
  certificate_token_id NUMERIC(78, 0) NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'transferred'
    CHECK (change_type IN ('registered', 'transferred', 'corrected')),
  from_profile_id BIGINT REFERENCES profiles(id),
  to_profile_id BIGINT NOT NULL REFERENCES profiles(id),
  from_wallet_address TEXT,
  to_wallet_address TEXT NOT NULL,
  blockchain_sale_id NUMERIC(78, 0),
  backend_transaction_id TEXT,
  tx_hash TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--tạo index cho property ownership history
CREATE INDEX IF NOT EXISTS idx_property_ownership_history_property
  ON property_ownership_history(property_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_ownership_history_smartcontract_property
  ON property_ownership_history(sc_property_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_ownership_history_to_wallet
  ON property_ownership_history(LOWER(to_wallet_address));

--tạo bảng triển khai smartcontract
CREATE TABLE IF NOT EXISTS contract_deployments(
  id BIGSERIAL PRIMARY KEY,
  chain_id NUMERIC(78, 0) NOT NULL CHECK (chain_id > 0),
  contract_name TEXT NOT NULL CHECK (BTRIM(contract_name) <> ''),
  contract_address TEXT NOT NULL CHECK (BTRIM(contract_address) <> ''),
  deploy_tx_hash TEXT,
  deployed_block_number NUMERIC(78, 0) NOT NULL CHECK (deployed_block_number >= 0),
  abi_version TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--tạo index cho contract deployments
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_deployments_address
  ON contract_deployments (chain_id, LOWER(contract_address));

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_deployments_one_active
  ON contract_deployments (chain_id, contract_name)
  WHERE active = TRUE; /*chỉ cho những contract đang active được bật*/

--tạo bảng lưu event của contract
CREATE TABLE IF NOT EXISTS contract_event_logs (
  id BIGSERIAL PRIMARY KEY,
  chain_id NUMERIC(78, 0) NOT NULL CHECK (chain_id >0),
  contract_name TEXT NOT NULL CHECK (BTRIM(contract_name) <> ''),
  contract_address TEXT NOT NULL CHECK (BTRIM(contract_address) <> ''),
  event_name TEXT NOT NULL CHECK (BTRIM(contract_address) <> ''),
  tx_hash TEXT NOT NULL,
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >0),
  log_index INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index) --không được trùng log_index và tx_hash
);

--tạo index cho event
CREATE INDEX IF NOT EXISTS idx_contract_event_logs_contract_event
  ON contract_event_logs (contract_name, event_name);

CREATE INDEX IF NOT EXISTS idx_contract_event_logs_block
  ON contract_event_logs (block_number, log_index);

--tạo bảng lưu lại hành động của user
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL CHECK (BTRIM(action) <> ''),
  actor_profile_id BIGINT REFERENCES profiles (id),
  actor_address TEXT CHECK (actor_address is NULL OR BTRIM(actor_address) <> ''),
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id BIGINT CHECK (entity_id >0),
  sc_property_id NUMERIC(78, 0) NOT NULL CHECK (sc_property_id >0),
  sc_sale_id NUMERIC(78, 0) NOT NULL CHECK (sc_sale_id >0),
  tx_hash TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--tạo index cho activity
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_created
  ON activity_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_actor
  ON activity_logs (LOWER(actor_address), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_entity
  ON activity_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_sc_property
  ON activity_logs (sc_property_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_sc_sale
  ON activity_logs (sc_sale_id);

 --luôn tự động cập nhật update_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ /*Function này dùng cho Trigger*/
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--Trigger là 1 bộ kích hoạt tự động lưu trữ dữ liệu khi có thao tác xảy ra
/*Lệnh thực hiện từng bước:
Drop trước để không bị lỗi already trigger exist sau mỗi lần run lại
Tạo lại trigger mói lấy upddate_at
*/

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_property_updated_at ON property;
CREATE TRIGGER trg_property_updated_at
BEFORE UPDATE ON property
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transfer_contract_updated_at ON transfer_contract;
CREATE TRIGGER trg_transfer_contract_updated_at
BEFORE UPDATE ON transfer_contract
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contract_deployments_updated_at ON contract_deployments;
CREATE TRIGGER trg_contract_deployments_updated_at
BEFORE UPDATE ON contract_deployments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

--tạo bảng ảo để thực thi lệnh truy vấn
-- Views for common backend screens/reports.
CREATE OR REPLACE VIEW property_overview AS
SELECT
  p.id,
  p.backend_property_id,
  p.sc_property_id,
  p.certificate_token_id,
  p.owner_profile_id,
  owner.full_name AS owner_full_name,
  p.owner_wallet_address,
  p.location,
  p.active,
  p.certificate_uri,
  p.created_at,
  p.updated_at,
  active_sale.id AS active_sale_id,
  active_sale.sc_sale_id AS active_sc_sale_id,
  active_sale.status AS active_sale_status
FROM property p
JOIN profiles owner ON owner.id = p.owner_profile_id
LEFT JOIN transfer_contract active_sale
  ON active_sale.property_id = p.id
  AND active_sale.status IN ('created', 'deposited');

CREATE OR REPLACE VIEW owner_property_summary AS
SELECT
  owner.id AS owner_profile_id,
  owner.wallet_address,
  owner.full_name,
  COUNT(p.id)::INT AS total_properties,
  COUNT(p.id) FILTER (WHERE p.active)::INT AS active_properties,
  MAX(p.updated_at) AS last_property_update
FROM profiles owner
LEFT JOIN property p ON p.owner_profile_id = owner.id
GROUP BY owner.id, owner.wallet_address, owner.full_name;

CREATE OR REPLACE VIEW sale_status_summary AS
SELECT
  status,
  COUNT(*)::INT AS total_sales,
  SUM(price_wei) AS total_price_wei,
  MAX(updated_at) AS last_sale_update
FROM transfer_contract
GROUP BY status;
