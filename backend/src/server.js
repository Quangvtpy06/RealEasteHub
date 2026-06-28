const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const { getAddress, verifyMessage, Wallet } = require('ethers');
const { query, withTransaction } = require('./db');
const {
  getContract,
  getRuntimeConfig,
  serialize,
  toBytes32,
  toUint256FromHash,
  waitForTransaction,
} = require('./services/contracts');
const {
  getIpfsConfig,
  ipfsToGatewayUrl,
  uploadBufferToIPFS,
  uploadJsonToIPFS,
} = require('./services/ipfs');
require('dotenv').config();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireText(body, field) {
  const value = body[field];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required`);
  }

  return value.trim();
}

function optionalText(body, field) {
  const value = body[field];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string`);
  }

  return value.trim();
}

function requirePositiveNumber(body, field) {
  const text = String(body[field] ?? '').trim();

  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a positive number`);
  }

  return text;
}

function optionalNonNegativeNumber(body, field) {
  const value = body[field];

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const text = String(value).trim();

  if (!/^[0-9]+$/.test(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a non-negative number`);
  }

  return text;
}

function parseId(value, field = 'id') {
  const text = String(value ?? '').trim();

  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a positive integer`);
  }

  return text;
}

function parseBoolean(value, field) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be true or false`);
}

function normalizeWalletAddress(value, field = 'wallet_address') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required`);
  }

  try {
    return getAddress(value.trim());
  } catch (error) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid wallet address`);
  }
}

function optionalWalletAddress(body, field = 'wallet_address') {
  const value = body[field];

  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return normalizeWalletAddress(String(value), field);
}


function requirePassword(body, field = 'password') {
  const value = body[field];

  if (typeof value !== 'string' || value.length < 6) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must have at least 6 characters`);
  }

  return value;
}

function requireRoleValue(body, field = 'role') {
  const value = requireText(body, field).toLowerCase();

  if (!['admin', 'user'].includes(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be admin or user`);
  }

  return value;
}

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-only-change-this-secret';
}

function shortWallet(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    profileId: user.profile_id,
    walletAddress: user.wallet_address,
    active: user.active,
    suspensionReason: user.suspension_reason,
    suspendedAt: user.suspended_at,
    suspendedByUserId: user.suspended_by_user_id,
  };
}

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
}

async function findActiveUserById(id) {
  const result = await query(`
    SELECT id, username, display_name, role, profile_id, wallet_address, active
    FROM app_users
    WHERE id = $1 AND active = TRUE
  `, [id]);

  return result.rows[0] || null;
}

function authenticate(req, res, next) {
  Promise.resolve().then(async () => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Login is required');
    }

    let decoded;

    try {
      decoded = jwt.verify(match[1], getJwtSecret());
    } catch (error) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Login session is invalid or expired');
    }

    const user = await findActiveUserById(decoded.sub);

    if (!user) {
      throw new ApiError(401, 'USER_INACTIVE', 'User is inactive or no longer exists');
    }

    req.user = user;
    next();
  }).catch(next);
}


let authSchemaReady = false;
let authSchemaPromise = null;

async function ensureAuthSchema() {
  if (authSchemaReady) {
    return;
  }

  if (authSchemaPromise) {
    return authSchemaPromise;
  }

  authSchemaPromise = (async () => {
    await query(`
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
      )
    `);

    await query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS wallet_address TEXT');
    await query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspension_reason TEXT');
    await query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ');
    await query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspended_by_user_id BIGINT REFERENCES app_users(id)');
    await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(LOWER(username))');
    await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_wallet ON app_users(LOWER(wallet_address)) WHERE wallet_address IS NOT NULL');
    await query('CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, active)');
    await query('CREATE INDEX IF NOT EXISTS idx_app_users_profile ON app_users(profile_id)');

    await query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await query('DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users');
    await query(`
      CREATE TRIGGER trg_app_users_updated_at
      BEFORE UPDATE ON app_users
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    `);

    authSchemaReady = true;
  })();

  try {
    await authSchemaPromise;
  } finally {
    authSchemaPromise = null;
  }
}

function ensureAuthSchemaMiddleware(req, res, next) {
  ensureAuthSchema().then(() => next()).catch(next);
}

let profileSchemaReady = false;
let profileSchemaPromise = null;

async function ensureProfileSchema() {
  if (profileSchemaReady) {
    return;
  }

  if (profileSchemaPromise) {
    return profileSchemaPromise;
  }

  profileSchemaPromise = (async () => {
    await query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''");
    profileSchemaReady = true;
  })();

  return profileSchemaPromise;
}

function ensureProfileSchemaMiddleware(req, res, next) {
  ensureProfileSchema().then(() => next()).catch(next);
}

const walletLoginChallenges = new Map();
const walletLoginTtlMs = 5 * 60 * 1000;

function buildWalletLoginMessage({ address, nonce, issuedAt, origin }) {
  return [
    'Property Chain requests wallet authentication.',
    '',
    `Wallet: ${address}`,
    `Origin: ${origin || 'Property Chain frontend'}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    'Only sign this message if you are logging in to the Property Chain demo.',
  ].join('\n');
}

function createWalletChallenge(address, origin) {
  const issuedAt = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = buildWalletLoginMessage({ address, nonce, issuedAt, origin });
  const expiresAt = Date.now() + walletLoginTtlMs;

  walletLoginChallenges.set(address.toLowerCase(), {
    address,
    nonce,
    message,
    expiresAt,
  });

  return {
    address,
    nonce,
    message,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function verifyWalletChallenge(address, signature) {
  if (typeof signature !== 'string' || signature.trim() === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'signature is required');
  }

  const key = address.toLowerCase();
  const challenge = walletLoginChallenges.get(key);

  if (!challenge || challenge.expiresAt < Date.now()) {
    walletLoginChallenges.delete(key);
    throw new ApiError(401, 'WALLET_CHALLENGE_EXPIRED', 'Wallet login request expired. Please try again');
  }

  let recovered;

  try {
    recovered = getAddress(verifyMessage(challenge.message, signature));
  } catch (error) {
    throw new ApiError(401, 'INVALID_WALLET_SIGNATURE', 'Wallet signature is invalid');
  }

  walletLoginChallenges.delete(key);

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new ApiError(401, 'WALLET_MISMATCH', 'Wallet signature does not match the selected account');
  }
}

async function findUserByWallet(address, activeOnly = true) {
  const result = await query(`
    SELECT id, username, display_name, role, profile_id, wallet_address, active, suspension_reason, suspended_at, suspended_by_user_id
    FROM app_users
    WHERE LOWER(wallet_address) = LOWER($1)
      ${activeOnly ? 'AND active = TRUE' : ''}
    LIMIT 1
  `, [address]);

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  const linked = await query(`
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.role,
      u.profile_id,
      COALESCE(u.wallet_address, p.wallet_address) AS wallet_address,
      u.active,
      u.suspension_reason,
      u.suspended_at,
      u.suspended_by_user_id
    FROM app_users u
    JOIN profiles p ON p.id = u.profile_id
    WHERE LOWER(p.wallet_address) = LOWER($1)
      ${activeOnly ? 'AND u.active = TRUE' : ''}
    ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.id
    LIMIT 1
  `, [address]);

  return linked.rows[0] || null;
}

async function findProfileByWallet(address) {
  const result = await query(`
    SELECT id, full_name, wallet_address
    FROM profiles
    WHERE LOWER(wallet_address) = LOWER($1)
    ORDER BY id DESC
    LIMIT 1
  `, [address]);

  return result.rows[0] || null;
}

async function createWalletUser({ address, role = 'user', displayName = null }) {
  const profile = await findProfileByWallet(address);
  const username = `wallet_${address.toLowerCase()}`;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const result = await query(`
    INSERT INTO app_users (username, password_hash, display_name, role, profile_id, wallet_address, active)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    RETURNING id, username, display_name, role, profile_id, wallet_address, active
  `, [
    username,
    passwordHash,
    displayName || profile?.full_name || `Wallet ${shortWallet(address)}`,
    role,
    profile?.id || null,
    address,
  ]);

  return result.rows[0];
}

function getConfiguredAdminWalletAddress() {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    return null;
  }

  try {
    return new Wallet(process.env.ADMIN_PRIVATE_KEY).address;
  } catch (error) {
    return null;
  }
}

async function linkConfiguredAdminWallet(address) {
  const configuredAdmin = getConfiguredAdminWalletAddress();

  if (!configuredAdmin || configuredAdmin.toLowerCase() !== address.toLowerCase()) {
    return null;
  }

  const result = await query(`
    UPDATE app_users
    SET wallet_address = $1,
        active = TRUE
    WHERE id = (
      SELECT id
      FROM app_users
      WHERE role = 'admin'
      ORDER BY id
      LIMIT 1
    )
    RETURNING id, username, display_name, role, profile_id, wallet_address, active
  `, [address]);

  return result.rows[0] || null;
}


let ipfsSchemaReady = false;

async function ensureIpfsSchema() {
  if (ipfsSchemaReady) {
    return;
  }

  await ensureAuthSchema();

  await query(`
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
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id, sort_order, created_at DESC)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_property_images_property_cid ON property_images(property_id, image_cid)');
  await query('CREATE INDEX IF NOT EXISTS idx_property_images_uploaded_by ON property_images(uploaded_by_user_id, created_at DESC)');

  ipfsSchemaReady = true;
}

function ensureIpfsSchemaMiddleware(req, res, next) {
  ensureIpfsSchema().then(() => next()).catch(next);
}

let transferSchemaReady = false;
let transferSchemaPromise = null;

let propertySchemaReady = false;
let propertySchemaPromise = null;

async function ensurePropertySchema() {
  if (propertySchemaReady) {
    return;
  }

  if (propertySchemaPromise) {
    return propertySchemaPromise;
  }

  propertySchemaPromise = (async () => {
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS asking_price_wei NUMERIC(78, 0) NOT NULL DEFAULT 0');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(18, 2) NOT NULL DEFAULT 0');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS rooms NUMERIC(18, 0) NOT NULL DEFAULT 0');
    await query("ALTER TABLE property ADD COLUMN IF NOT EXISTS valuation_report_hash TEXT DEFAULT ''");
    await query("ALTER TABLE property ADD COLUMN IF NOT EXISTS valuation_report_uri TEXT DEFAULT ''");
    await query("ALTER TABLE property ADD COLUMN IF NOT EXISTS listing_status TEXT NOT NULL DEFAULT 'unlisted'");
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS listing_sale_id NUMERIC(78, 0)');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS listing_tx_hash TEXT');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ');
    await query("ALTER TABLE property ADD COLUMN IF NOT EXISTS risk_status TEXT NOT NULL DEFAULT 'clear'");
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS risk_reason TEXT');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS risk_flagged_at TIMESTAMPTZ');
    await query('ALTER TABLE property ADD COLUMN IF NOT EXISTS risk_flagged_by_user_id BIGINT REFERENCES app_users(id)');
    await query('CREATE INDEX IF NOT EXISTS idx_property_listing_status ON property(listing_status, updated_at DESC)');
    await query('CREATE INDEX IF NOT EXISTS idx_property_risk_status ON property(risk_status, active, updated_at DESC)');
    propertySchemaReady = true;
  })();

  try {
    await propertySchemaPromise;
  } finally {
    propertySchemaPromise = null;
  }
}

function ensurePropertySchemaMiddleware(req, res, next) {
  ensurePropertySchema().then(() => next()).catch(next);
}

async function ensureTransferSchema() {
  if (transferSchemaReady) {
    return;
  }

  if (transferSchemaPromise) {
    return transferSchemaPromise;
  }

  transferSchemaPromise = (async () => {
    await query('ALTER TABLE transfer_contract ADD COLUMN IF NOT EXISTS seller_acceptance_message TEXT');
    await query('ALTER TABLE transfer_contract ADD COLUMN IF NOT EXISTS seller_signature TEXT');
    await query('ALTER TABLE transfer_contract ADD COLUMN IF NOT EXISTS seller_signed_at TIMESTAMPTZ');
    await query('ALTER TABLE transfer_contract ADD COLUMN IF NOT EXISTS fee_wei NUMERIC(78, 0)');
    transferSchemaReady = true;
  })();

  try {
    await transferSchemaPromise;
  } finally {
    transferSchemaPromise = null;
  }
}

function ensureTransferSchemaMiddleware(req, res, next) {
  ensureTransferSchema().then(() => next()).catch(next);
}

async function getPropertyRecord(propertyId) {
  const result = await query(`
    SELECT *
    FROM property
    WHERE id = $1
  `, [propertyId]);

  if (result.rowCount === 0) {
    throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
  }

  return result.rows[0];
}

function requirePropertyEditor(req, property) {
  if (req.user.role === 'admin') {
    return;
  }

  if (req.user.profile_id && String(req.user.profile_id) === String(property.owner_profile_id)) {
    return;
  }

  if (req.user.wallet_address && sameWallet(req.user.wallet_address, property.owner_wallet_address)) {
    return;
  }

  throw new ApiError(403, 'FORBIDDEN', 'Only admin or the linked property owner can upload IPFS data');
}

function sameWallet(left, right) {
  return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
}

function requireWalletParticipant(req, ...wallets) {
  if (req.user.role === 'admin') {
    return;
  }

  if (wallets.some((wallet) => sameWallet(req.user.wallet_address, wallet))) {
    return;
  }

  throw new ApiError(403, 'FORBIDDEN', 'Only a linked wallet participant can perform this action');
}

function requireSellerWallet(req, sellerWallet) {
  if (sameWallet(req.user.wallet_address, sellerWallet)) {
    return;
  }

  throw new ApiError(403, 'ONLY_SELLER_WALLET', 'Only the seller wallet can sign this transfer');
}

function buildSellerAcceptanceMessage(transfer) {
  return [
    'Property Chain seller acceptance.',
    'Only sign this message if you accept selling this NFT certificate.',
    `Transfer DB ID: ${transfer.id}`,
    `Backend transaction: ${transfer.backend_transaction_id}`,
    `Property DB ID: ${transfer.property_id}`,
    `SC property ID: ${transfer.sc_property_id}`,
    `Token ID: ${transfer.certificate_token_id}`,
    `Seller: ${getAddress(transfer.seller_wallet_address)}`,
    `Buyer: ${getAddress(transfer.buyer_wallet_address)}`,
    `Price wei: ${transfer.price_wei}`,
    `Document hash: ${transfer.document_hash}`,
  ].join('\n');
}

function buildPropertyMetadata(property, images, overrides = {}) {
  // Chỉ lấy file ảnh thật, loại bỏ PDF (sổ đỏ/thẩm định giá) vốn cũng nằm trong cùng bảng property_images
  const imageOnly = images.filter((image) => String(image.mime_type || '').toLowerCase().startsWith('image/'));
  const primaryImage = imageOnly[0] || null;
  // Dùng gateway_url (https://...) thay vì image_uri (ipfs://...) để MetaMask chắc chắn hiển thị được avatar
  const imageUri = overrides.image_uri || primaryImage?.gateway_url || primaryImage?.image_uri || '';

  return {
    name: overrides.name || `Property Certificate #${property.id}`,
    description: overrides.description || 'NFT dai dien giay chung nhan quyen so huu bat dong san.',
    image: imageUri,
    external_url: overrides.external_url || '',
    properties: {
      databasePropertyId: String(property.id),
      backendPropertyId: property.backend_property_id,
      smartContractPropertyId: property.sc_property_id ? String(property.sc_property_id) : '',
      certificateTokenId: property.certificate_token_id ? String(property.certificate_token_id) : '',
      location: property.location,
      propertyDataHash: property.property_data_hash,
      legalDocumentHash: property.legal_document_hash,
      askingPriceWei: property.asking_price_wei ? String(property.asking_price_wei) : '0',
      images: images.map((image) => ({
        cid: image.image_cid,
        uri: image.image_uri,
        gatewayUrl: image.gateway_url,
        caption: image.caption,
      })),
    },
    attributes: [
      { trait_type: 'Database Property ID', value: String(property.id) },
      { trait_type: 'Backend Property ID', value: property.backend_property_id },
      { trait_type: 'Location', value: property.location },
      { trait_type: 'Asking Price Wei', value: property.asking_price_wei ? String(property.asking_price_wei) : '0' },
      { trait_type: 'Certificate Type', value: 'Property Ownership' },
      { trait_type: 'Active', value: property.active ? 'true' : 'false' },
    ],
  };
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'AUTH_REQUIRED', 'Login is required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action'));
    }

    return next();
  };
}

function sendCreated(res, data) {
  res.status(201).json({ data });
}

const app = express();
const port = Number(process.env.PORT || 3000);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  },
  fileFilter: (req, file, callback) => {
    const mimetype = file.mimetype || '';
    // Route này dùng chung cho ảnh tài sản (image/*) lẫn file pháp lý/thẩm định giá (application/pdf)
    const isAllowed = mimetype.startsWith('image/') || mimetype === 'application/pdf';

    if (!isAllowed) {
      return callback(new ApiError(400, 'INVALID_FILE_TYPE', 'Only image or PDF uploads are allowed'));
    }

    return callback(null, true);
  },
});


app.use(cors());
app.use(express.json());

app.get('/api/health', asyncHandler(async (req, res) => {
  const result = await query('SELECT NOW() AS database_time');
  res.json({
    ok: true,
    service: 'blockchain-property-backend',
    databaseTime: result.rows[0].database_time,
  });
}));


app.use('/api/auth', ensureAuthSchemaMiddleware);

app.get('/api/auth/setup-status', asyncHandler(async (req, res) => {
  const adminCount = await query("SELECT COUNT(*)::INT AS total FROM app_users WHERE role = 'admin'");
  const adminExists = adminCount.rows[0].total > 0;

  res.json({
    data: {
      adminExists,
      setupAllowed: !adminExists,
    },
  });
}));

app.post('/api/auth/wallet/nonce', asyncHandler(async (req, res) => {
  const address = normalizeWalletAddress(req.body.wallet_address || req.body.address);
  const challenge = createWalletChallenge(address, req.get('origin') || req.get('host'));

  res.json({ data: challenge });
}));

app.post('/api/auth/wallet/login', asyncHandler(async (req, res) => {
  const address = normalizeWalletAddress(req.body.wallet_address || req.body.address);
  verifyWalletChallenge(address, requireText(req.body, 'signature'));

  let user = await findUserByWallet(address, false);

  if (user && !user.active) {
    throw new ApiError(401, 'USER_INACTIVE', user.suspension_reason || 'This wallet has been disabled on the platform');
  }

  if (!user) {
    user = await linkConfiguredAdminWallet(address);
  }

  if (!user) {
    user = await createWalletUser({ address, role: 'user' });
  }

  res.json({
    data: {
      token: signAuthToken(user),
      user: sanitizeUser(user),
    },
  });
}));

app.post('/api/auth/setup-wallet', asyncHandler(async (req, res) => {
  const adminCount = await query("SELECT COUNT(*)::INT AS total FROM app_users WHERE role = 'admin'");

  if (adminCount.rows[0].total > 0) {
    throw new ApiError(409, 'ADMIN_ALREADY_EXISTS', 'Initial admin already exists');
  }

  const address = normalizeWalletAddress(req.body.wallet_address || req.body.address);
  verifyWalletChallenge(address, requireText(req.body, 'signature'));

  const existing = await findUserByWallet(address, false);
  let user;

  if (existing) {
    const updated = await query(`
      UPDATE app_users
      SET role = 'admin',
          active = TRUE,
          wallet_address = $1,
          display_name = COALESCE($2, display_name)
      WHERE id = $3
      RETURNING id, username, display_name, role, profile_id, wallet_address, active
    `, [address, optionalText(req.body, 'display_name'), existing.id]);
    user = updated.rows[0];
  } else {
    user = await createWalletUser({
      address,
      role: 'admin',
      displayName: optionalText(req.body, 'display_name') || `Admin ${shortWallet(address)}`,
    });
  }

  res.status(201).json({
    data: {
      token: signAuthToken(user),
      user: sanitizeUser(user),
    },
  });
}));

app.post('/api/auth/setup', asyncHandler(async (req, res) => {
  const adminCount = await query("SELECT COUNT(*)::INT AS total FROM app_users WHERE role = 'admin'");

  if (adminCount.rows[0].total > 0) {
    throw new ApiError(409, 'ADMIN_ALREADY_EXISTS', 'Initial admin already exists');
  }

  const passwordHash = await bcrypt.hash(requirePassword(req.body), 12);
  const result = await query(`
    INSERT INTO app_users (username, password_hash, display_name, role)
    VALUES ($1, $2, $3, 'admin')
    RETURNING id, username, display_name, role, profile_id, wallet_address, active
  `, [
    requireText(req.body, 'username'),
    passwordHash,
    optionalText(req.body, 'display_name') || requireText(req.body, 'username'),
  ]);

  const user = result.rows[0];
  res.status(201).json({
    data: {
      token: signAuthToken(user),
      user: sanitizeUser(user),
    },
  });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const username = requireText(req.body, 'username');
  const password = requirePassword(req.body);
  const result = await query(`
    SELECT id, username, password_hash, display_name, role, profile_id, wallet_address, active
    FROM app_users
    WHERE LOWER(username) = LOWER($1)
    LIMIT 1
  `, [username]);

  if (result.rowCount === 0 || !result.rows[0].active) {
    throw new ApiError(401, 'INVALID_LOGIN', 'Username or password is incorrect');
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    throw new ApiError(401, 'INVALID_LOGIN', 'Username or password is incorrect');
  }

  res.json({
    data: {
      token: signAuthToken(user),
      user: sanitizeUser(user),
    },
  });
}));

app.get('/api/auth/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ data: sanitizeUser(req.user) });
}));

app.get('/api/auth/users', authenticate, requireRoles('admin'), asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT
      id,
      username,
      display_name,
      role,
      profile_id,
      wallet_address,
      active,
      suspension_reason,
      suspended_at,
      suspended_by_user_id,
      created_at,
      updated_at
    FROM app_users
    ORDER BY created_at DESC
  `);

  res.json({ count: result.rowCount, data: result.rows.map(sanitizeUser) });
}));

app.post('/api/auth/users', authenticate, requireRoles('admin'), asyncHandler(async (req, res) => {
  const passwordHash = await bcrypt.hash(
    req.body.password ? requirePassword(req.body) : crypto.randomBytes(32).toString('hex'),
    12,
  );
  const walletAddress = optionalWalletAddress(req.body);
  const result = await query(`
    INSERT INTO app_users (username, password_hash, display_name, role, profile_id, wallet_address, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, username, display_name, role, profile_id, wallet_address, active
  `, [
    requireText(req.body, 'username'),
    passwordHash,
    optionalText(req.body, 'display_name') || requireText(req.body, 'username'),
    requireRoleValue(req.body),
    optionalNonNegativeNumber(req.body, 'profile_id'),
    walletAddress,
    req.body.active === undefined ? true : parseBoolean(req.body.active, 'active'),
  ]);

  sendCreated(res, sanitizeUser(result.rows[0]));
}));

app.patch('/api/auth/users/:id/active', authenticate, requireRoles('admin'), asyncHandler(async (req, res) => {
  const userId = parseId(req.params.id);
  const nextActive = parseBoolean(req.body.active, 'active');
  const reason = optionalText(req.body, 'reason') || optionalText(req.body, 'suspension_reason');

  if (!nextActive && String(userId) === String(req.user.id)) {
    throw new ApiError(400, 'CANNOT_DISABLE_SELF', 'Admin cannot disable the current login account');
  }

  const target = await query('SELECT id, role FROM app_users WHERE id = $1', [userId]);

  if (target.rowCount === 0) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }

  if (!nextActive && target.rows[0].role === 'admin') {
    const admins = await query(
      "SELECT COUNT(*)::INT AS total FROM app_users WHERE role = 'admin' AND active = TRUE AND id <> $1",
      [userId],
    );

    if (admins.rows[0].total === 0) {
      throw new ApiError(400, 'LAST_ADMIN_REQUIRED', 'At least one active admin account is required');
    }
  }

  const result = await query(`
    UPDATE app_users
    SET active = $1,
        suspension_reason = CASE WHEN $1 = TRUE THEN NULL ELSE COALESCE($2, suspension_reason, 'Platform access disabled by admin') END,
        suspended_at = CASE WHEN $1 = TRUE THEN NULL ELSE NOW() END,
        suspended_by_user_id = CASE WHEN $1 = TRUE THEN NULL ELSE $3::BIGINT END,
        updated_at = NOW()
    WHERE id = $4
    RETURNING id, username, display_name, role, profile_id, wallet_address, active, suspension_reason, suspended_at, suspended_by_user_id
  `, [
    nextActive,
    reason,
    req.user.id,
    userId,
  ]);

  res.json({ data: sanitizeUser(result.rows[0]) });
}));

// Middleware to allow public read-only access to certain endpoints
const authenticateIfNeeded = (req, res, next) => {
  const publicPaths = ['/properties', '/profiles', '/transfers', '/ledger', '/blockchain'];
  const isPublic = publicPaths.some(path => req.path.startsWith(path)) && req.method === 'GET';
  
  if (isPublic) {
    return next();
  }
  
  return authenticate(req, res, next);
};

app.use('/api', authenticateIfNeeded);

app.get('/api/profiles', ensureProfileSchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT *
    FROM profiles
    ORDER BY created_at DESC
    LIMIT 100
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.post('/api/profiles', ensureProfileSchemaMiddleware, asyncHandler(async (req, res) => {
  const walletAddress = normalizeWalletAddress(req.body.wallet_address);
  const passwordHash = req.body.password ? await bcrypt.hash(requirePassword(req.body), 12) : null;

  if (req.user.role !== 'admin' && !sameWallet(req.user.wallet_address, walletAddress)) {
    throw new ApiError(403, 'FORBIDDEN', 'Users can only create a profile for their own login wallet');
  }

  const result = await withTransaction(async (client) => {
    const inserted = await client.query(`
      INSERT INTO profiles (
        backend_person_id,
        backend_person_hash,
        wallet_address,
        full_name,
        country,
        identify_id,
        email,
        phone,
        address,
        profile_data_hash,
        verified,
        registry_tx_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      requireText(req.body, 'backend_person_id'),
      requireText(req.body, 'backend_person_hash'),
      walletAddress,
      requireText(req.body, 'full_name'),
      requireText(req.body, 'country'),
      requirePositiveNumber(req.body, 'identify_id'),
      optionalText(req.body, 'email') || '',
      requireText(req.body, 'phone'),
      optionalText(req.body, 'address') || '',
      requireText(req.body, 'profile_data_hash'),
      true,
      optionalText(req.body, 'registry_tx_hash'),
    ]);

    if (sameWallet(req.user.wallet_address, walletAddress)) {
      await client.query(
        `
          UPDATE app_users
          SET profile_id = $1,
              display_name = $2,
              password_hash = COALESCE($3, password_hash)
          WHERE id = $4
        `,
        [inserted.rows[0].id, requireText(req.body, 'full_name'), passwordHash, req.user.id],
      );
    }

    return inserted;
  });

  sendCreated(res, result.rows[0]);
}));

app.patch('/api/profiles/:id/verification', requireRoles('admin'), asyncHandler(async (req, res) => {
  const result = await query(`
    UPDATE profiles
    SET verified = $1,
        registry_tx_hash = COALESCE($2, registry_tx_hash)
    WHERE id = $3
    RETURNING *
  `, [
    parseBoolean(req.body.verified, 'verified'),
    optionalText(req.body, 'registry_tx_hash'),
    parseId(req.params.id),
  ]);

  if (result.rowCount === 0) {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }

  res.json({ data: result.rows[0] });
}));

app.post('/api/profiles/:id/ekyc', authenticate, asyncHandler(async (req, res) => {
  const profileId = parseId(req.params.id, 'id');
  const result = await query('SELECT * FROM profiles WHERE id = $1', [profileId]);

  if (result.rowCount === 0) {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }

  const profile = result.rows[0];

  // Only admin or the owner wallet may mark eKYC as complete for this profile
  if (req.user.role !== 'admin') {
    if (!req.user.wallet_address || !sameWallet(req.user.wallet_address, profile.wallet_address)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only admin or the profile owner may complete eKYC');
    }
  }

  const updated = await query(`
    UPDATE profiles
    SET verified = TRUE,
        registry_tx_hash = COALESCE($2, registry_tx_hash),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [profileId, optionalText(req.body, 'registry_tx_hash')]);

  res.json({ data: updated.rows[0] });
}));

app.get('/api/properties', ensurePropertySchemaMiddleware, ensureIpfsSchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT
      p.*,
      owner.full_name AS owner_full_name,
      first_image.image_uri AS first_image_uri,
      first_image.gateway_url AS first_image_gateway_url
    FROM property p
    JOIN profiles owner ON owner.id = p.owner_profile_id
    LEFT JOIN LATERAL (
      SELECT image_uri, gateway_url
      FROM property_images
      WHERE property_id = p.id
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    ) first_image ON TRUE
    ORDER BY p.created_at DESC
    LIMIT 100
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.post('/api/properties', ensurePropertySchemaMiddleware, asyncHandler(async (req, res) => {
  const ownerProfileId = parseId(req.body.owner_profile_id, 'owner_profile_id');

  const result = await withTransaction(async (client) => {
    const owner = await client.query(
      'SELECT id, wallet_address FROM profiles WHERE id = $1',
      [ownerProfileId],
    );

    if (owner.rowCount === 0) {
      throw new ApiError(404, 'OWNER_PROFILE_NOT_FOUND', 'Owner profile not found');
    }

    if (req.user.role !== 'admin' && !sameWallet(req.user.wallet_address, owner.rows[0].wallet_address)) {
      throw new ApiError(403, 'FORBIDDEN', 'You can only create a property for your own wallet profile');
    }

    const inserted = await client.query(`
      INSERT INTO property (
        backend_property_id,
        backend_property_hash,
        sc_property_id,
        certificate_token_id,
        owner_profile_id,
        owner_wallet_address,
        location,
        property_data_hash,
        legal_document_hash,
        area_m2,
        rooms,
        valuation_report_hash,
        valuation_report_uri,
        certificate_uri,
        asking_price_wei,
        active,
        registry_tx_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      requireText(req.body, 'backend_property_id'),
      requireText(req.body, 'backend_property_hash'),
      optionalNonNegativeNumber(req.body, 'sc_property_id'),
      optionalNonNegativeNumber(req.body, 'certificate_token_id'),
      ownerProfileId,
      owner.rows[0].wallet_address,
      requireText(req.body, 'location'),
      requireText(req.body, 'property_data_hash'),
      requireText(req.body, 'legal_document_hash'),
      optionalNonNegativeNumber(req.body, 'area_m2') || '0',
      optionalNonNegativeNumber(req.body, 'rooms') || '0',
      optionalText(req.body, 'valuation_report_hash') || '',
      optionalText(req.body, 'valuation_report_uri') || '',
      requireText(req.body, 'certificate_uri'),
      optionalNonNegativeNumber(req.body, 'asking_price_wei') || '0',
      req.body.active === undefined ? true : parseBoolean(req.body.active, 'active'),
      optionalText(req.body, 'registry_tx_hash'),
    ]);

    return inserted;
  });

  sendCreated(res, result.rows[0]);
}));

app.patch('/api/properties/:id/blockchain', ensurePropertySchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  const result = await withTransaction(async (client) => {
    const propertyResult = await client.query('SELECT * FROM property WHERE id = $1 FOR UPDATE', [id]);

    if (propertyResult.rowCount === 0) {
      throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }

    const property = propertyResult.rows[0];
    requirePropertyEditor(req, property);

    const scPropertyId = optionalNonNegativeNumber(req.body, 'sc_property_id');
    const certificateTokenId = optionalNonNegativeNumber(req.body, 'certificate_token_id');

    const updated = await client.query(`
      UPDATE property
      SET sc_property_id = COALESCE($1, sc_property_id),
          certificate_token_id = COALESCE($2, certificate_token_id),
          registry_tx_hash = COALESCE($3, registry_tx_hash)
      WHERE id = $4
      RETURNING *
    `, [
      scPropertyId,
      certificateTokenId,
      optionalText(req.body, 'registry_tx_hash'),
      id,
    ]);

    const hadOnChainRecord = property.sc_property_id !== null && property.certificate_token_id !== null;
    const hasOnChainRecord = updated.rows[0].sc_property_id !== null && updated.rows[0].certificate_token_id !== null;

    if (!hadOnChainRecord && hasOnChainRecord) {
      await client.query(`
        INSERT INTO property_ownership_history (
          property_id,
          sc_property_id,
          certificate_token_id,
          change_type,
          to_profile_id,
          to_wallet_address,
          tx_hash
        )
        VALUES ($1, $2, $3, 'registered', $4, $5, $6)
      `, [
        updated.rows[0].id,
        updated.rows[0].sc_property_id,
        updated.rows[0].certificate_token_id,
        updated.rows[0].owner_profile_id,
        updated.rows[0].owner_wallet_address,
        updated.rows[0].registry_tx_hash,
      ]);
    }

    return updated;
  });

  res.json({ data: result.rows[0] });
}));

app.patch('/api/properties/:id/listing', ensurePropertySchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const listingStatus = optionalText(req.body, 'listing_status') || 'listed';

  if (!['unlisted', 'listed', 'sold', 'cancelled'].includes(listingStatus)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'listing_status must be unlisted, listed, sold, or cancelled');
  }

  const result = await withTransaction(async (client) => {
    const propertyResult = await client.query('SELECT * FROM property WHERE id = $1 FOR UPDATE', [id]);

    if (propertyResult.rowCount === 0) {
      throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }

    const property = propertyResult.rows[0];
    requirePropertyEditor(req, property);

    if (!property.active && listingStatus === 'listed') {
      throw new ApiError(400, 'PROPERTY_INACTIVE', 'Property is disabled and cannot be listed');
    }

    if (listingStatus === 'listed' && (property.sc_property_id === null || property.certificate_token_id === null)) {
      throw new ApiError(400, 'PROPERTY_NOT_ON_CHAIN', 'Property must be minted before listing');
    }

    const askingPriceWei = optionalNonNegativeNumber(req.body, 'asking_price_wei');
    const listingSaleId = optionalNonNegativeNumber(req.body, 'listing_sale_id');
    const listingTxHash = optionalText(req.body, 'listing_tx_hash');

    if (listingStatus === 'listed' && (!listingSaleId || !listingTxHash)) {
      throw new ApiError(400, 'LISTING_TX_REQUIRED', 'listing_sale_id and listing_tx_hash are required when listing');
    }

    return client.query(`
      UPDATE property
      SET listing_status = $1,
          listing_sale_id = COALESCE($2, listing_sale_id),
          listing_tx_hash = COALESCE($3, listing_tx_hash),
          asking_price_wei = COALESCE($4, asking_price_wei),
          listed_at = CASE WHEN $1 = 'listed' THEN NOW() ELSE listed_at END,
          sold_at = CASE WHEN $1 = 'sold' THEN NOW() WHEN $1 = 'listed' THEN NULL ELSE sold_at END,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [
      listingStatus,
      listingSaleId,
      listingTxHash,
      askingPriceWei,
      id,
    ]);
  });

  res.json({ data: result.rows[0] });
}));

app.patch('/api/properties/:id/risk', ensurePropertySchemaMiddleware, requireRoles('admin'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const nextActive = parseBoolean(req.body.active, 'active');
  const reason = optionalText(req.body, 'reason') || optionalText(req.body, 'risk_reason');

  if (!nextActive && !reason) {
    throw new ApiError(400, 'RISK_REASON_REQUIRED', 'risk_reason is required when disabling an NFT/property');
  }

  const result = await query(`
    UPDATE property
    SET active = $1,
        risk_status = CASE WHEN $1 = TRUE THEN 'clear' ELSE 'blocked' END,
        risk_reason = CASE WHEN $1 = TRUE THEN NULL ELSE $2 END,
        risk_flagged_at = CASE WHEN $1 = TRUE THEN NULL ELSE NOW() END,
        risk_flagged_by_user_id = CASE WHEN $1 = TRUE THEN NULL ELSE $3::BIGINT END,
        listing_status = CASE WHEN $1 = FALSE AND listing_status = 'listed' THEN 'cancelled' ELSE listing_status END,
        listed_at = CASE WHEN $1 = FALSE AND listing_status = 'listed' THEN NULL ELSE listed_at END,
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
  `, [
    nextActive,
    reason,
    req.user.id,
    id,
  ]);

  if (result.rowCount === 0) {
    throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
  }

  const property = result.rows[0];
  let chainSync = {
    attempted: false,
    ok: null,
  };

  if (property.sc_property_id) {
    try {
      const registry = await getContract('registry', { write: true });
      const tx = await registry.setPropertyActive(property.sc_property_id, nextActive);
      chainSync = {
        attempted: true,
        ok: true,
        ...await waitForTransaction(tx),
      };
    } catch (error) {
      chainSync = {
        attempted: true,
        ok: false,
        error: error.message,
      };
    }
  }

  res.json({ data: { ...property, chainSync } });
}));


app.get('/api/ipfs/status', asyncHandler(async (req, res) => {
  res.json({ data: getIpfsConfig() });
}));

app.get('/api/properties/:id/images', ensureIpfsSchemaMiddleware, asyncHandler(async (req, res) => {
  const propertyId = parseId(req.params.id);
  await getPropertyRecord(propertyId);

  const result = await query(`
    SELECT *
    FROM property_images
    WHERE property_id = $1
    ORDER BY sort_order ASC, created_at ASC
  `, [propertyId]);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.post(
  '/api/properties/:id/images',
  ensureIpfsSchemaMiddleware,
  imageUpload.single('image'),
  asyncHandler(async (req, res) => {
    const propertyId = parseId(req.params.id);
    const property = await getPropertyRecord(propertyId);
    requirePropertyEditor(req, property);

    if (!req.file) {
      throw new ApiError(400, 'IMAGE_REQUIRED', 'image file is required');
    }

    const upload = await uploadBufferToIPFS({
      buffer: req.file.buffer,
      filename: req.file.originalname || `property-${propertyId}.jpg`,
      mimeType: req.file.mimetype,
      metadata: {
        type: 'property-image',
        propertyId: String(propertyId),
        backendPropertyId: property.backend_property_id,
        uploadedBy: req.user.username,
      },
    });

    const result = await query(`
      INSERT INTO property_images (
        property_id,
        image_cid,
        image_uri,
        gateway_url,
        mime_type,
        original_name,
        caption,
        sort_order,
        uploaded_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (property_id, image_cid)
      DO UPDATE SET
        gateway_url = EXCLUDED.gateway_url,
        caption = EXCLUDED.caption,
        sort_order = EXCLUDED.sort_order
      RETURNING *
    `, [
      propertyId,
      upload.cid,
      upload.uri,
      upload.gatewayUrl,
      req.file.mimetype,
      req.file.originalname || '',
      optionalText(req.body, 'caption') || '',
      optionalNonNegativeNumber(req.body, 'sort_order') || '0',
      req.user.id,
    ]);

    sendCreated(res, {
      ...result.rows[0],
      pinata: {
        cid: upload.cid,
        uri: upload.uri,
        gatewayUrl: upload.gatewayUrl,
      },
    });
  }),
);

app.post('/api/properties/:id/metadata', ensureIpfsSchemaMiddleware, asyncHandler(async (req, res) => {
  const propertyId = parseId(req.params.id);
  const property = await getPropertyRecord(propertyId);
  requirePropertyEditor(req, property);

  const images = await query(`
    SELECT *
    FROM property_images
    WHERE property_id = $1
    ORDER BY sort_order ASC, created_at ASC
  `, [propertyId]);

  if (images.rowCount === 0 && !optionalText(req.body, 'image_uri')) {
    throw new ApiError(400, 'PROPERTY_IMAGE_REQUIRED', 'Upload at least one property image before creating NFT metadata');
  }

  const metadata = buildPropertyMetadata(property, images.rows, {
    name: optionalText(req.body, 'name'),
    description: optionalText(req.body, 'description'),
    external_url: optionalText(req.body, 'external_url'),
    image_uri: optionalText(req.body, 'image_uri'),
  });

  const upload = await uploadJsonToIPFS({
    json: metadata,
    name: `property-${propertyId}-metadata.json`,
    metadata: {
      type: 'property-nft-metadata',
      propertyId: String(propertyId),
      backendPropertyId: property.backend_property_id,
      uploadedBy: req.user.username,
    },
  });

  const updated = await query(`
    UPDATE property
    SET certificate_uri = $1
    WHERE id = $2
    RETURNING *
  `, [upload.uri, propertyId]);

  res.status(201).json({
    data: {
      cid: upload.cid,
      uri: upload.uri,
      gatewayUrl: upload.gatewayUrl,
      metadata,
      property: updated.rows[0],
    },
  });
}));

app.get('/api/transfers', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT t.*, p.location, seller.full_name AS seller_full_name, buyer.full_name AS buyer_full_name
    FROM transfer_contract t
    JOIN property p ON p.id = t.property_id
    JOIN profiles seller ON seller.id = t.seller_profile_id
    JOIN profiles buyer ON buyer.id = t.buyer_profile_id
    ORDER BY t.created_at DESC
    LIMIT 100
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.get('/api/ledger/transfers', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT
      t.id,
      t.backend_transaction_id,
      t.backend_transaction_hash,
      t.sc_sale_id,
      t.property_id,
      t.sc_property_id,
      t.certificate_token_id,
      t.seller_profile_id,
      seller.full_name AS seller_full_name,
      t.seller_wallet_address,
      t.buyer_profile_id,
      buyer.full_name AS buyer_full_name,
      t.buyer_wallet_address,
      t.price_wei,
      t.document_hash,
      t.status,
      t.create_tx_hash,
      t.deposit_tx_hash,
      t.release_tx_hash,
      t.cancel_tx_hash,
      t.fee_wei,
      t.created_at,
      t.deposited_at,
      t.released_at,
      t.cancelled_at,
      t.updated_at,
      p.location,
      p.certificate_uri,
      p.owner_profile_id AS current_owner_profile_id,
      current_owner.full_name AS current_owner_full_name,
      p.owner_wallet_address AS current_owner_wallet_address,
      first_image.gateway_url AS first_image_gateway_url,
      first_image.image_uri AS first_image_uri
    FROM transfer_contract t
    JOIN property p ON p.id = t.property_id
    JOIN profiles seller ON seller.id = t.seller_profile_id
    JOIN profiles buyer ON buyer.id = t.buyer_profile_id
    JOIN profiles current_owner ON current_owner.id = p.owner_profile_id
    LEFT JOIN LATERAL (
      SELECT image_uri, gateway_url
      FROM property_images
      WHERE property_id = p.id
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    ) first_image ON TRUE
    ORDER BY COALESCE(t.released_at, t.cancelled_at, t.deposited_at, t.created_at) DESC
    LIMIT 200
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.get('/api/ledger/ownership', ensurePropertySchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT
      p.id AS property_id,
      p.backend_property_id,
      p.sc_property_id,
      p.certificate_token_id,
      p.location,
      p.certificate_uri,
      p.asking_price_wei,
      p.listing_status,
      p.listing_sale_id,
      p.listing_tx_hash,
      p.listed_at,
      p.sold_at,
      p.active,
      p.risk_status,
      p.risk_reason,
      p.risk_flagged_at,
      p.risk_flagged_by_user_id,
      p.owner_profile_id,
      owner.full_name AS owner_full_name,
      owner.wallet_address AS owner_wallet_address,
      owner.verified AS owner_verified,
      first_image.gateway_url AS first_image_gateway_url,
      first_image.image_uri AS first_image_uri,
      history.last_changed_at,
      history.total_changes
    FROM property p
    JOIN profiles owner ON owner.id = p.owner_profile_id
    LEFT JOIN LATERAL (
      SELECT image_uri, gateway_url
      FROM property_images
      WHERE property_id = p.id
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    ) first_image ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        MAX(changed_at) AS last_changed_at,
        COUNT(*)::INT AS total_changes
      FROM property_ownership_history
      WHERE property_id = p.id
    ) history ON TRUE
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT 200
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.post('/api/transfers', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const propertyId = parseId(req.body.property_id, 'property_id');
  const buyerProfileId = parseId(req.body.buyer_profile_id, 'buyer_profile_id');

  const result = await withTransaction(async (client) => {
    const propertyResult = await client.query(
      'SELECT * FROM property WHERE id = $1 FOR UPDATE',
      [propertyId],
    );

    if (propertyResult.rowCount === 0) {
      throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }

    const property = propertyResult.rows[0];

    if (!property.active) {
      throw new ApiError(400, 'PROPERTY_INACTIVE', 'Property is inactive');
    }

    if (property.sc_property_id === null || property.certificate_token_id === null) {
      throw new ApiError(400, 'PROPERTY_NOT_ON_CHAIN', 'Property must have sc_property_id and certificate_token_id first');
    }

    const priceWei = requirePositiveNumber(req.body, 'price_wei');
    const askingPriceWei = BigInt(property.asking_price_wei || 0);

    if (askingPriceWei > 0n && BigInt(priceWei) !== askingPriceWei) {
      throw new ApiError(400, 'PRICE_MISMATCH', 'Transfer price must match the seller asking price');
    }

    const buyer = await client.query(
      'SELECT id, wallet_address FROM profiles WHERE id = $1',
      [buyerProfileId],
    );

    if (buyer.rowCount === 0) {
      throw new ApiError(404, 'BUYER_PROFILE_NOT_FOUND', 'Buyer profile not found');
    }

    if (req.user.role !== 'admin' && !sameWallet(req.user.wallet_address, buyer.rows[0].wallet_address)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the buyer wallet can create this transfer request');
    }

    const inserted = await client.query(`
      INSERT INTO transfer_contract (
        backend_transaction_id,
        backend_transaction_hash,
        sc_sale_id,
        property_id,
        sc_property_id,
        certificate_token_id,
        seller_profile_id,
        buyer_profile_id,
        seller_wallet_address,
        buyer_wallet_address,
        price_wei,
        document_hash,
        create_tx_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      requireText(req.body, 'backend_transaction_id'),
      requireText(req.body, 'backend_transaction_hash'),
      optionalNonNegativeNumber(req.body, 'sc_sale_id'),
      property.id,
      property.sc_property_id,
      property.certificate_token_id,
      property.owner_profile_id,
      buyerProfileId,
      property.owner_wallet_address,
      buyer.rows[0].wallet_address,
      priceWei,
      requireText(req.body, 'document_hash'),
      optionalText(req.body, 'create_tx_hash'),
    ]);

    return inserted;
  });

  sendCreated(res, result.rows[0]);
}));

app.post('/api/transfers/purchase', ensurePropertySchemaMiddleware, ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const propertyId = parseId(req.body.property_id, 'property_id');
  const buyerProfileId = parseId(req.body.buyer_profile_id, 'buyer_profile_id');

  const result = await withTransaction(async (client) => {
    const propertyResult = await client.query('SELECT * FROM property WHERE id = $1 FOR UPDATE', [propertyId]);

    if (propertyResult.rowCount === 0) {
      throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }

    const property = propertyResult.rows[0];

    if (!property.active) {
      throw new ApiError(400, 'PROPERTY_INACTIVE', 'Property is disabled and cannot be purchased');
    }

    if (property.listing_status !== 'listed') {
      throw new ApiError(400, 'PROPERTY_NOT_LISTED', 'Property must be listed before purchase');
    }

    const buyer = await client.query(
      'SELECT id, wallet_address FROM profiles WHERE id = $1',
      [buyerProfileId],
    );

    if (buyer.rowCount === 0) {
      throw new ApiError(404, 'BUYER_PROFILE_NOT_FOUND', 'Buyer profile not found');
    }

    if (req.user.role !== 'admin' && !sameWallet(req.user.wallet_address, buyer.rows[0].wallet_address)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the buyer wallet can record this purchase');
    }

    const priceWei = requirePositiveNumber(req.body, 'price_wei');
    const askingPriceWei = BigInt(property.asking_price_wei || 0);

    if (askingPriceWei <= 0n) {
      throw new ApiError(400, 'PRICE_NOT_LISTED', 'Listed property must have a positive asking price');
    }

    if (BigInt(priceWei) !== askingPriceWei) {
      throw new ApiError(400, 'PRICE_MISMATCH', 'Purchase price must match the listing price');
    }

    const saleId = optionalNonNegativeNumber(req.body, 'sc_sale_id') || property.listing_sale_id;
    const buyTxHash = requireText(req.body, 'buy_tx_hash');
    const expectedFeeWei = ((BigInt(priceWei) * 100n) / 10000n).toString();
    const feeWei = optionalNonNegativeNumber(req.body, 'fee_wei') || expectedFeeWei;
    const backendTransactionId = optionalText(req.body, 'backend_transaction_id') || `BUY-${property.id}-${buyTxHash.slice(2, 12)}`;
    const backendTransactionHash = optionalText(req.body, 'backend_transaction_hash') || buyTxHash;
    const documentHash = optionalText(req.body, 'document_hash') || `BUY-DOC-${property.id}`;

    if (!saleId || String(saleId) !== String(property.listing_sale_id)) {
      throw new ApiError(400, 'SALE_ID_MISMATCH', 'Purchase saleId must match the active listing');
    }

    if (BigInt(feeWei) !== BigInt(expectedFeeWei)) {
      throw new ApiError(400, 'FEE_MISMATCH', 'Purchase fee must be 1% of listing price');
    }

    const inserted = await client.query(`
      INSERT INTO transfer_contract (
        backend_transaction_id,
        backend_transaction_hash,
        sc_sale_id,
        property_id,
        sc_property_id,
        certificate_token_id,
        seller_profile_id,
        buyer_profile_id,
        seller_wallet_address,
        buyer_wallet_address,
        price_wei,
        document_hash,
        status,
        create_tx_hash,
        deposit_tx_hash,
        release_tx_hash,
        fee_wei,
        deposited_at,
        released_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'released', $13, $14, $15, $16, NOW(), NOW())
      RETURNING *
    `, [
      backendTransactionId,
      backendTransactionHash,
      saleId,
      property.id,
      property.sc_property_id,
      property.certificate_token_id,
      property.owner_profile_id,
      buyerProfileId,
      property.owner_wallet_address,
      buyer.rows[0].wallet_address,
      priceWei,
      documentHash,
      property.listing_tx_hash,
      property.listing_tx_hash,
      buyTxHash,
      feeWei,
    ]);

    await client.query(`
      UPDATE property
      SET owner_profile_id = $1,
          owner_wallet_address = $2,
          listing_status = 'sold',
          sold_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
    `, [buyerProfileId, buyer.rows[0].wallet_address, property.id]);

    await client.query(`
      INSERT INTO property_ownership_history (
        property_id,
        sc_property_id,
        certificate_token_id,
        change_type,
        from_profile_id,
        to_profile_id,
        from_wallet_address,
        to_wallet_address,
        blockchain_sale_id,
        backend_transaction_id,
        tx_hash
      )
      VALUES ($1, $2, $3, 'transferred', $4, $5, $6, $7, $8, $9, $10)
    `, [
      property.id,
      property.sc_property_id,
      property.certificate_token_id,
      property.owner_profile_id,
      buyerProfileId,
      property.owner_wallet_address,
      buyer.rows[0].wallet_address,
      saleId,
      backendTransactionId,
      buyTxHash,
    ]);

    return inserted;
  });

  sendCreated(res, result.rows[0]);
}));

app.get('/api/transfers/:id/seller-message', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM transfer_contract WHERE id = $1', [parseId(req.params.id)]);

  if (result.rowCount === 0) {
    throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
  }

  const transfer = result.rows[0];
  requireSellerWallet(req, transfer.seller_wallet_address);

  res.json({ data: { message: buildSellerAcceptanceMessage(transfer) } });
}));

app.patch('/api/transfers/:id/seller-signature', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const signature = requireText(req.body, 'signature');

  const result = await withTransaction(async (client) => {
    const transferResult = await client.query('SELECT * FROM transfer_contract WHERE id = $1 FOR UPDATE', [id]);

    if (transferResult.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = transferResult.rows[0];
    requireSellerWallet(req, transfer.seller_wallet_address);

    if (transfer.status !== 'created') {
      throw new ApiError(400, 'TRANSFER_NOT_SIGNABLE', 'Transfer must be in created status');
    }

    const message = buildSellerAcceptanceMessage(transfer);
    const recovered = getAddress(verifyMessage(message, signature));

    if (!sameWallet(recovered, transfer.seller_wallet_address)) {
      throw new ApiError(401, 'INVALID_SELLER_SIGNATURE', 'Seller signature does not match the seller wallet');
    }

    return client.query(`
      UPDATE transfer_contract
      SET seller_acceptance_message = $1,
          seller_signature = $2,
          seller_signed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [message, signature, id]);
  });

  res.json({ data: result.rows[0] });
}));

app.patch('/api/transfers/:id/sale', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  const result = await withTransaction(async (client) => {
    const transferResult = await client.query('SELECT * FROM transfer_contract WHERE id = $1 FOR UPDATE', [id]);

    if (transferResult.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = transferResult.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address);

    if (!transfer.seller_signature) {
      throw new ApiError(400, 'SELLER_SIGNATURE_REQUIRED', 'Seller must sign the transfer acceptance first');
    }

    return client.query(`
      UPDATE transfer_contract
      SET sc_sale_id = COALESCE($1, sc_sale_id),
          create_tx_hash = COALESCE($2, create_tx_hash)
      WHERE id = $3 AND status = 'created'
      RETURNING *
    `, [
      optionalNonNegativeNumber(req.body, 'sc_sale_id'),
      optionalText(req.body, 'create_tx_hash'),
      id,
    ]);
  });

  if (result.rowCount === 0) {
    throw new ApiError(400, 'TRANSFER_NOT_UPDATABLE', 'Transfer must be in created status');
  }

  res.json({ data: result.rows[0] });
}));

app.patch('/api/transfers/:id/deposit', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  const result = await withTransaction(async (client) => {
    const transferResult = await client.query('SELECT * FROM transfer_contract WHERE id = $1 FOR UPDATE', [id]);

    if (transferResult.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = transferResult.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address);

    if (!transfer.seller_signature) {
      throw new ApiError(400, 'SELLER_SIGNATURE_REQUIRED', 'Seller must sign the transfer acceptance first');
    }

    return client.query(`
      UPDATE transfer_contract
      SET status = 'deposited',
          deposit_tx_hash = COALESCE($1, deposit_tx_hash),
          fee_wei = COALESCE($2, fee_wei),
          deposited_at = NOW()
      WHERE id = $3 AND status = 'created'
      RETURNING *
    `, [
      optionalText(req.body, 'deposit_tx_hash'),
      optionalNonNegativeNumber(req.body, 'fee_wei'),
      id,
    ]);
  });

  if (result.rowCount === 0) {
    throw new ApiError(400, 'TRANSFER_NOT_DEPOSITABLE', 'Transfer must be in created status');
  }

  res.json({ data: result.rows[0] });
}));

app.patch('/api/transfers/:id/release', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  const result = await withTransaction(async (client) => {
    const transferResult = await client.query(
      'SELECT * FROM transfer_contract WHERE id = $1 FOR UPDATE',
      [id],
    );

    if (transferResult.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = transferResult.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address, transfer.buyer_wallet_address);

    if (transfer.status !== 'deposited') {
      throw new ApiError(400, 'TRANSFER_NOT_RELEASABLE', 'Transfer must be in deposited status');
    }

    const updated = await client.query(`
      UPDATE transfer_contract
      SET status = 'released',
          release_tx_hash = COALESCE($1, release_tx_hash),
          released_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [optionalText(req.body, 'release_tx_hash'), id]);

    await client.query(`
      UPDATE property
      SET owner_profile_id = $1,
          owner_wallet_address = $2
      WHERE id = $3
    `, [transfer.buyer_profile_id, transfer.buyer_wallet_address, transfer.property_id]);

    await client.query(`
      INSERT INTO property_ownership_history (
        property_id,
        sc_property_id,
        certificate_token_id,
        change_type,
        from_profile_id,
        to_profile_id,
        from_wallet_address,
        to_wallet_address,
        blockchain_sale_id,
        backend_transaction_id,
        tx_hash
      )
      VALUES ($1, $2, $3, 'transferred', $4, $5, $6, $7, $8, $9, $10)
    `, [
      transfer.property_id,
      transfer.sc_property_id,
      transfer.certificate_token_id,
      transfer.seller_profile_id,
      transfer.buyer_profile_id,
      transfer.seller_wallet_address,
      transfer.buyer_wallet_address,
      transfer.sc_sale_id,
      transfer.backend_transaction_id,
      optionalText(req.body, 'release_tx_hash'),
    ]);

    return updated;
  });

  res.json({ data: result.rows[0] });
}));

app.patch('/api/transfers/:id/cancel', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  const result = await withTransaction(async (client) => {
    const transferResult = await client.query('SELECT * FROM transfer_contract WHERE id = $1 FOR UPDATE', [id]);

    if (transferResult.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = transferResult.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address, transfer.buyer_wallet_address);

    return client.query(`
      UPDATE transfer_contract
      SET status = 'cancelled',
          cancel_tx_hash = COALESCE($1, cancel_tx_hash),
          cancelled_at = NOW()
      WHERE id = $2 AND status IN ('created', 'deposited')
      RETURNING *
    `, [optionalText(req.body, 'cancel_tx_hash'), id]);
  });

  if (result.rowCount === 0) {
    throw new ApiError(400, 'TRANSFER_NOT_CANCELLABLE', 'Transfer must be in created or deposited status');
  }

  res.json({ data: result.rows[0] });
}));

app.get('/api/contracts', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT *
    FROM contract_deployments
    ORDER BY created_at DESC
  `);

  res.json({ count: result.rowCount, data: result.rows });
}));

app.post('/api/contracts', requireRoles('admin'), asyncHandler(async (req, res) => {
  const result = await query(`
    INSERT INTO contract_deployments (
      chain_id,
      contract_name,
      contract_address,
      deploy_tx_hash,
      deployed_block_number,
      abi_version,
      active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    requirePositiveNumber(req.body, 'chain_id'),
    requireText(req.body, 'contract_name'),
    requireText(req.body, 'contract_address'),
    optionalText(req.body, 'deploy_tx_hash'),
    optionalNonNegativeNumber(req.body, 'deployed_block_number') || '0',
    optionalText(req.body, 'abi_version') || '',
    req.body.active === undefined ? true : parseBoolean(req.body.active, 'active'),
  ]);

  sendCreated(res, result.rows[0]);
}));

app.get('/api/blockchain/status', asyncHandler(async (req, res) => {
  const config = await getRuntimeConfig();
  res.json({ data: config });
}));

app.get('/api/blockchain/registry/properties/:propertyId', asyncHandler(async (req, res) => {
  const registry = await getContract('registry');
  const property = await registry.getProperty(parseId(req.params.propertyId, 'propertyId'));
  res.json({ data: serialize(property) });
}));

app.get('/api/blockchain/registry/ownership/:propertyId/:account', asyncHandler(async (req, res) => {
  const registry = await getContract('registry');
  const verified = await registry.verifyOwnership(
    parseId(req.params.propertyId, 'propertyId'),
    requireText(req.params, 'account'),
  );
  res.json({ data: { verified } });
}));

app.get('/api/blockchain/nft/:tokenId', asyncHandler(async (req, res) => {
  const nft = await getContract('nft');
  const tokenId = parseId(req.params.tokenId, 'tokenId');
  const [owner, tokenUri, propertyId] = await Promise.all([
    nft.ownerOf(tokenId),
    nft.tokenURI(tokenId),
    nft.propertyID_ofToken(tokenId),
  ]);

  res.json({
    data: serialize({
      tokenId,
      owner,
      tokenUri,
      propertyId,
    }),
  });
}));

app.get('/api/blockchain/escrow/sales/:saleId', asyncHandler(async (req, res) => {
  const escrow = await getContract('escrow');
  const sale = await escrow.getCertificateSale(parseId(req.params.saleId, 'saleId'));
  res.json({ data: serialize(sale) });
}));

app.post('/api/blockchain/registry/register-person', asyncHandler(async (req, res) => {
  const registry = await getContract('registry', { write: true });
  const backendPersonIdText = requireText(req.body, 'backend_person_id');
  const walletAddress = normalizeWalletAddress(req.body.wallet_address);

  if (req.user.role !== 'admin' && !sameWallet(req.user.wallet_address, walletAddress)) {
    throw new ApiError(403, 'FORBIDDEN', 'Users can only verify their own login wallet');
  }

  const backendPersonId = toBytes32(backendPersonIdText);
  const zeroPersonId = `0x${'0'.repeat(64)}`;
  let receipt;

  const currentPersonId = await registry.personIdByWallet(walletAddress);

  if (String(currentPersonId).toLowerCase() !== zeroPersonId) {
    if (String(currentPersonId).toLowerCase() !== String(backendPersonId).toLowerCase()) {
      throw new ApiError(409, 'WALLET_USED_ON_CHAIN', 'This wallet is already registered on-chain with another profile');
    }

    const alreadyVerified = await registry.isVerifiedWallet(walletAddress);

    if (alreadyVerified) {
      receipt = {
        txHash: null,
        blockNumber: null,
        status: 1,
        alreadyRegistered: true,
        alreadyVerified: true,
      };
    } else {
      const tx = await registry.setPersonVerified(backendPersonId, true);
      receipt = await waitForTransaction(tx);
    }
  } else {
    const tx = await registry.RegisterPerson(
      backendPersonId,
      walletAddress,
      toUint256FromHash(requireText(req.body, 'profile_data_hash')),
      true,
    );
    receipt = await waitForTransaction(tx);
  }

  await query(`
    UPDATE profiles
    SET verified = TRUE,
        registry_tx_hash = COALESCE($1, registry_tx_hash)
    WHERE backend_person_id = $2
      AND LOWER(wallet_address) = LOWER($3)
  `, [receipt.txHash, backendPersonIdText, walletAddress]);

  res.status(201).json({ data: { ...receipt, verified: true } });
}));

app.post('/api/blockchain/registry/verify-person', requireRoles('admin'), asyncHandler(async (req, res) => {
  const registry = await getContract('registry', { write: true });
  const tx = await registry.setPersonVerified(
    toBytes32(requireText(req.body, 'backend_person_id')),
    parseBoolean(req.body.verified, 'verified'),
  );
  res.json({ data: await waitForTransaction(tx) });
}));

app.post('/api/blockchain/registry/register-property', requireRoles('admin'), asyncHandler(async (req, res) => {
  const registry = await getContract('registry', { write: true });
  const tx = await registry.registerProperty(
    toBytes32(requireText(req.body, 'backend_property_id')),
    requireText(req.body, 'initial_owner'),
    toBytes32(requireText(req.body, 'property_data_hash')),
    toBytes32(requireText(req.body, 'legal_document_hash')),
    requireText(req.body, 'location'),
    requireText(req.body, 'certificate_uri'),
  );
  const receipt = await waitForTransaction(tx);
  res.status(201).json({ data: receipt });
}));

// Cập nhật certificate_uri on-chain cho NFT đã mint (vd: sau khi tạo lại metadata với ảnh đúng).
// Admin hoặc đúng owner hiện tại của property đều được phép yêu cầu hành động này (requirePropertyEditor).
// Lưu ý: dù ai gọi API, transaction on-chain vẫn luôn được backend ký bằng ví admin (MANAGER_ROLE
// trên PropertyRegistry) — nới quyền ở đây chỉ thay đổi ai được phép *yêu cầu*, không đổi ví ký giao dịch.
app.patch('/api/properties/:id/certificate-uri', ensurePropertySchemaMiddleware, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const certificateUri = requireText(req.body, 'certificate_uri');

  const result = await withTransaction(async (client) => {
    const propertyResult = await client.query('SELECT * FROM property WHERE id = $1 FOR UPDATE', [id]);

    if (propertyResult.rowCount === 0) {
      throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found');
    }

    const property = propertyResult.rows[0];
    requirePropertyEditor(req, property);

    if (property.sc_property_id === null || property.sc_property_id === undefined) {
      throw new ApiError(400, 'PROPERTY_NOT_ON_CHAIN', 'Property must be minted on-chain before updating certificate URI');
    }

    const registry = await getContract('registry', { write: true });
    const tx = await registry.updateCertificateURI(property.sc_property_id, certificateUri);
    const receipt = await waitForTransaction(tx);

    const updated = await client.query(`
      UPDATE property
      SET certificate_uri = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [certificateUri, id]);

    return { property: updated.rows[0], receipt };
  });

  res.json({ data: result });
}));

app.post('/api/blockchain/escrow/release', requireRoles('admin'), ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const transferId = req.body.transfer_id === undefined || req.body.transfer_id === null || req.body.transfer_id === ''
    ? null
    : parseId(req.body.transfer_id, 'transfer_id');
  const saleId = parseId(req.body.sale_id, 'sale_id');

  if (transferId) {
    const result = await query('SELECT * FROM transfer_contract WHERE id = $1', [transferId]);

    if (result.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = result.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address, transfer.buyer_wallet_address);

    if (transfer.status !== 'deposited') {
      throw new ApiError(400, 'TRANSFER_NOT_RELEASABLE', 'Transfer must be deposited before release');
    }
  }

  const escrow = await getContract('escrow', { write: true });
  const tx = await escrow.releaseCertificateToBuyer(saleId);
  res.json({ data: await waitForTransaction(tx) });
}));

app.post('/api/blockchain/escrow/cancel', ensureTransferSchemaMiddleware, asyncHandler(async (req, res) => {
  const transferId = req.body.transfer_id === undefined || req.body.transfer_id === null || req.body.transfer_id === ''
    ? null
    : parseId(req.body.transfer_id, 'transfer_id');
  const saleId = parseId(req.body.sale_id, 'sale_id');

  if (transferId) {
    const result = await query('SELECT * FROM transfer_contract WHERE id = $1', [transferId]);

    if (result.rowCount === 0) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    const transfer = result.rows[0];
    requireWalletParticipant(req, transfer.seller_wallet_address, transfer.buyer_wallet_address);

    if (!['created', 'deposited'].includes(transfer.status)) {
      throw new ApiError(400, 'TRANSFER_NOT_CANCELLABLE', 'Transfer must be created or deposited before cancel');
    }
  } else if (req.user.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'transfer_id is required for non-admin cancel requests');
  }

  const escrow = await getContract('escrow', { write: true });
  const tx = await escrow.cancelCertificateSale(saleId);
  res.json({ data: await waitForTransaction(tx) });
}));

app.post('/api/blockchain/roles/grant-registry-role', requireRoles('admin'), asyncHandler(async (req, res) => {
  const nft = await getContract('nft', { write: true });
  const role = await nft.RegistryRole();
  const tx = await nft.grantRole(role, requireText(req.body, 'registry_address'));
  res.json({ data: await waitForTransaction(tx) });
}));

app.post('/api/blockchain/roles/grant-escrow-role', requireRoles('admin'), asyncHandler(async (req, res) => {
  const nft = await getContract('nft', { write: true });
  const registry = await getContract('registry', { write: true });
  const escrowAddress = requireText(req.body, 'escrow_address');
  const nftRole = await nft.EscrowRole();
  const registryRole = await registry.ESCROW_ROLE();
  const nftTx = await nft.grantRole(nftRole, escrowAddress);
  const nftReceipt = await waitForTransaction(nftTx);
  const registryTx = await registry.grantRole(registryRole, escrowAddress);
  const registryReceipt = await waitForTransaction(registryTx);
  res.json({ data: { nft: nftReceipt, registry: registryReceipt } });
}));

app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'API route not found',
  });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.code || 'UPLOAD_ERROR',
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large' : error.message,
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message,
    });
  }

  if (error.code === '23505') {
    return res.status(409).json({
      error: 'DUPLICATE_DATA',
      message: 'Unique database constraint was violated',
      detail: error.detail,
    });
  }

  if (error.code === '23503') {
    return res.status(400).json({
      error: 'FOREIGN_KEY_ERROR',
      message: 'Referenced data does not exist',
      detail: error.detail,
    });
  }

  if (error.code === '23514') {
    return res.status(400).json({
      error: 'CHECK_CONSTRAINT_ERROR',
      message: 'Input data violates a database check constraint',
      detail: error.detail,
    });
  }

  console.error(error);
  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: error.message,
  });
});

app.listen(port, () => {
  console.log(`Backend API is running at http://localhost:${port}`);
});