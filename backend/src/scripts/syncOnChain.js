const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Wallet } = require('ethers');
const { pool, withTransaction } = require('../db');
const { getContract } = require('../services/contracts');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SALE_STATUS = {
  0: 'none',
  1: 'listed',
  2: 'sold',
  3: 'cancelled',
};

function sameWallet(left, right) {
  return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
}

function isRealWallet(wallet) {
  return Boolean(wallet && !sameWallet(wallet, ZERO_ADDRESS));
}

function shortWallet(address) {
  return `${String(address).slice(0, 6)}...${String(address).slice(-4)}`;
}

function readField(row, name, index) {
  if (row && row[name] !== undefined) {
    return row[name];
  }

  if (row && row[index] !== undefined) {
    return row[index];
  }

  return null;
}

function stringValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function uintString(value, fallback = '0') {
  if (value === null || value === undefined) return fallback;
  return BigInt(value.toString()).toString();
}

function dateFromUnix(value) {
  const timestamp = Number(uintString(value, '0'));
  return timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null;
}

function hexLabel(prefix, value, fallback = '') {
  const text = String(value || fallback || '').replace(/^0x/i, '').toUpperCase();
  return `${prefix}-${text.slice(0, 16) || 'UNKNOWN'}`;
}

function adminWalletAddress() {
  if (!process.env.ADMIN_PRIVATE_KEY) return '';

  try {
    return new Wallet(process.env.ADMIN_PRIVATE_KEY).address;
  } catch (error) {
    return '';
  }
}

function normalizePerson(raw, fallbackWallet) {
  if (!raw) {
    return {
      backendPersonId: null,
      datahash: null,
      wallet: fallbackWallet,
      verified: true,
    };
  }

  return {
    backendPersonId: stringValue(readField(raw, 'backendPersonId', 0), null),
    datahash: stringValue(readField(raw, 'datahash', 1), null),
    wallet: stringValue(readField(raw, 'wallet', 2), fallbackWallet),
    verified: Boolean(readField(raw, 'verified', 3)),
    createdAt: dateFromUnix(readField(raw, 'CreatedAt', 4)),
    updatedAt: dateFromUnix(readField(raw, 'UpdatedAt', 5)),
  };
}

function normalizeProperty(raw) {
  const id = uintString(readField(raw, 'id', 0), '0');
  if (id === '0') return null;

  return {
    id,
    backendPropertyId: stringValue(readField(raw, 'backendPropertyId', 1)),
    propertydataHash: stringValue(readField(raw, 'propertydataHash', 2)),
    legalDocumentHash: stringValue(readField(raw, 'legalDocumentHash', 3)),
    certificateTokenId: uintString(readField(raw, 'certificateTokenId', 4)),
    currentOwner: stringValue(readField(raw, 'currentOwner', 5)),
    createdBy: stringValue(readField(raw, 'createdBy', 6)),
    location: stringValue(readField(raw, 'location', 7), `On-chain property ${id}`),
    certificateURI: stringValue(readField(raw, 'certificateURI', 8), `onchain://property/${id}`),
    active: Boolean(readField(raw, 'active', 9)),
    createdAt: dateFromUnix(readField(raw, 'createdAt', 10)),
    updatedAt: dateFromUnix(readField(raw, 'updatedAt', 11)),
  };
}

function normalizeSale(raw) {
  const id = uintString(readField(raw, 'id', 0), '0');
  if (id === '0') return null;

  const statusCode = Number(uintString(readField(raw, 'status', 8), '0'));

  return {
    id,
    propertyId: uintString(readField(raw, 'propertyId', 1)),
    certificateTokenId: uintString(readField(raw, 'certificateTokenId', 2)),
    seller: stringValue(readField(raw, 'seller', 3)),
    buyer: stringValue(readField(raw, 'buyer', 4)),
    priceWei: uintString(readField(raw, 'priceWei', 5)),
    backendTransactionId: stringValue(readField(raw, 'backendTransactionId', 6)),
    documentHash: stringValue(readField(raw, 'documentHash', 7), `ONCHAIN-SALE-${id}-DOC`),
    statusCode,
    status: SALE_STATUS[statusCode] || 'none',
    createdAt: dateFromUnix(readField(raw, 'createdAt', 9)),
    depositedAt: dateFromUnix(readField(raw, 'depositedAt', 10)),
    releasedAt: dateFromUnix(readField(raw, 'releasedAt', 11)),
    cancelledAt: dateFromUnix(readField(raw, 'cancelledAt', 12)),
    releasedBy: stringValue(readField(raw, 'releasedBy', 13)),
  };
}

async function findPersonByWalletOnChain(registry, wallet) {
  if (!isRealWallet(wallet)) return normalizePerson(null, wallet);

  try {
    return normalizePerson(await registry.getPersonByWallet(wallet), wallet);
  } catch (error) {
    return normalizePerson(null, wallet);
  }
}

async function ensureProfile(client, wallet, personInfo = {}) {
  const backendPersonId = personInfo.backendPersonId
    ? hexLabel('ONCHAIN-PERSON', personInfo.backendPersonId)
    : hexLabel('ONCHAIN-WALLET', wallet);
  const backendPersonHash = personInfo.backendPersonId || `wallet:${wallet.toLowerCase()}`;
  const profileDataHash = personInfo.datahash || `wallet:${wallet.toLowerCase()}`;

  const existing = await client.query(`
    SELECT *
    FROM profiles
    WHERE LOWER(wallet_address) = LOWER($1)
       OR backend_person_hash = $2
    ORDER BY id
    LIMIT 1
  `, [wallet, backendPersonHash]);

  if (existing.rowCount > 0) {
    const updated = await client.query(`
      UPDATE profiles
      SET wallet_address = $2,
          verified = TRUE,
          profile_data_hash = COALESCE(NULLIF(profile_data_hash, ''), $3),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [existing.rows[0].id, wallet, profileDataHash]);
    return updated.rows[0];
  }

  const identifySeed = BigInt(`0x${wallet.slice(2, 18)}`).toString();
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
      profile_data_hash,
      verified
    )
    VALUES ($1, $2, $3, $4, 'Viet Nam', $5, '', $6, $7, TRUE)
    RETURNING *
  `, [
    backendPersonId,
    backendPersonHash,
    wallet,
    `On-chain wallet ${shortWallet(wallet)}`,
    identifySeed,
    `onchain-${wallet.slice(2, 12).toLowerCase()}`,
    profileDataHash,
  ]);

  return inserted.rows[0];
}

async function ensureAppUser(client, profile) {
  const existing = await client.query(`
    SELECT *
    FROM app_users
    WHERE LOWER(wallet_address) = LOWER($1)
       OR profile_id = $2
    ORDER BY id
    LIMIT 1
  `, [profile.wallet_address, profile.id]);

  const role = sameWallet(profile.wallet_address, adminWalletAddress()) ? 'admin' : 'user';

  if (existing.rowCount > 0) {
    await client.query(`
      UPDATE app_users
      SET profile_id = $1,
          wallet_address = COALESCE(wallet_address, $2),
          active = TRUE,
          updated_at = NOW()
      WHERE id = $3
    `, [profile.id, profile.wallet_address, existing.rows[0].id]);
    return existing.rows[0].id;
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const inserted = await client.query(`
    INSERT INTO app_users (username, password_hash, display_name, role, profile_id, wallet_address, active)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    RETURNING id
  `, [
    `wallet_${profile.wallet_address.toLowerCase()}`,
    passwordHash,
    profile.full_name || `Wallet ${shortWallet(profile.wallet_address)}`,
    role,
    profile.id,
    profile.wallet_address,
  ]);

  return inserted.rows[0].id;
}

async function ensureProfileAndUser(client, registry, wallet, stats) {
  if (!isRealWallet(wallet)) return null;

  const before = await client.query(
    'SELECT id FROM profiles WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1',
    [wallet],
  );
  const profile = await ensureProfile(client, wallet, await findPersonByWalletOnChain(registry, wallet));
  await ensureAppUser(client, profile);

  if (before.rowCount === 0) stats.profilesCreated += 1;
  stats.profilesSynced += 1;
  return profile;
}

async function readOnChainProperties(registry) {
  const nextPropertyId = Number(await registry.nextPropertyId());
  const properties = [];

  for (let propertyId = 1; propertyId < nextPropertyId; propertyId += 1) {
    try {
      const property = normalizeProperty(await registry.getProperty(propertyId));
      if (property) properties.push(property);
    } catch (error) {
      console.warn(`Skipped property ${propertyId}: ${error.shortMessage || error.message}`);
    }
  }

  return { nextPropertyId, properties };
}

async function readOnChainSales(escrow) {
  const nextSaleId = Number(await escrow.nextSaleId().catch(() => 1));
  const sales = [];

  for (let saleId = 1; saleId < nextSaleId; saleId += 1) {
    try {
      const sale = normalizeSale(await escrow.getCertificateSale(saleId));
      if (sale) {
        sale.feeWei = uintString(await escrow.saleFeeWei(saleId).catch(() => '0'));
        if (sale.feeWei === '0' && sale.priceWei !== '0') {
          sale.feeWei = uintString(await escrow.getTransactionFee(sale.priceWei).catch(() => '0'));
        }
        sales.push(sale);
      }
    } catch (error) {
      console.warn(`Skipped sale ${saleId}: ${error.shortMessage || error.message}`);
    }
  }

  return { nextSaleId, sales };
}

function latestSaleStateByProperty(sales) {
  const map = new Map();

  for (const sale of sales) {
    const existing = map.get(sale.propertyId);
    if (!existing || BigInt(sale.id) > BigInt(existing.id)) {
      map.set(sale.propertyId, sale);
    }
  }

  return map;
}

function firstSoldSaleByProperty(sales) {
  const map = new Map();

  for (const sale of sales.filter((item) => item.status === 'sold')) {
    const existing = map.get(sale.propertyId);
    if (!existing || BigInt(sale.id) < BigInt(existing.id)) {
      map.set(sale.propertyId, sale);
    }
  }

  return map;
}

async function findExistingProperty(client, property) {
  const direct = await client.query(`
    SELECT id
    FROM property
    WHERE sc_property_id = $1
       OR certificate_token_id = $2
       OR backend_property_hash = $3
    ORDER BY id
    LIMIT 1
  `, [property.id, property.certificateTokenId, property.backendPropertyId]);

  if (direct.rowCount > 0) {
    return direct.rows[0].id;
  }

  const draft = await client.query(`
    SELECT id
    FROM property
    WHERE sc_property_id IS NULL
      AND certificate_token_id IS NULL
      AND LOWER(location) = LOWER($1)
    ORDER BY updated_at DESC
    LIMIT 2
  `, [property.location]);

  return draft.rowCount === 1 ? draft.rows[0].id : null;
}

async function upsertProperty(client, registry, property, saleState, firstSoldSale, stats) {
  const ownerProfile = await ensureProfileAndUser(client, registry, property.currentOwner, stats);
  const registrationWallet = firstSoldSale?.seller || property.currentOwner;
  const registrationProfile = await ensureProfileAndUser(client, registry, registrationWallet, stats);
  const dbPropertyId = await findExistingProperty(client, property);

  const listingStatus = saleState?.status === 'listed'
    ? 'listed'
    : saleState?.status === 'sold'
      ? 'sold'
      : saleState?.status === 'cancelled'
        ? 'cancelled'
        : 'unlisted';
  const askingPriceWei = saleState?.priceWei || '0';
  const listedAt = saleState?.createdAt || null;
  const soldAt = saleState?.status === 'sold' ? saleState.releasedAt : null;

  let propertyRowId = dbPropertyId;

  if (propertyRowId) {
    await client.query(`
      UPDATE property
      SET backend_property_hash = $1,
          sc_property_id = $2,
          certificate_token_id = $3,
          owner_profile_id = $4,
          owner_wallet_address = $5,
          location = $6,
          property_data_hash = $7,
          legal_document_hash = $8,
          certificate_uri = $9,
          asking_price_wei = $10,
          listing_status = $11,
          listing_sale_id = $12,
          listed_at = COALESCE(listed_at, $13),
          sold_at = COALESCE(sold_at, $14),
          active = $15,
          updated_at = NOW()
      WHERE id = $16
    `, [
      property.backendPropertyId,
      property.id,
      property.certificateTokenId,
      ownerProfile.id,
      property.currentOwner,
      property.location,
      property.propertydataHash,
      property.legalDocumentHash,
      property.certificateURI,
      askingPriceWei,
      listingStatus,
      saleState?.id || null,
      listedAt,
      soldAt,
      property.active,
      propertyRowId,
    ]);
    stats.propertiesUpdated += 1;
  } else {
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
        certificate_uri,
        asking_price_wei,
        listing_status,
        listing_sale_id,
        listed_at,
        sold_at,
        active,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, NOW()))
      RETURNING id
    `, [
      `ONCHAIN-PROPERTY-${property.id}`,
      property.backendPropertyId,
      property.id,
      property.certificateTokenId,
      ownerProfile.id,
      property.currentOwner,
      property.location,
      property.propertydataHash,
      property.legalDocumentHash,
      property.certificateURI,
      askingPriceWei,
      listingStatus,
      saleState?.id || null,
      listedAt,
      soldAt,
      property.active,
      property.createdAt,
    ]);
    propertyRowId = inserted.rows[0].id;
    stats.propertiesCreated += 1;
  }

  await client.query(`
    INSERT INTO property_ownership_history (
      property_id,
      sc_property_id,
      certificate_token_id,
      change_type,
      to_profile_id,
      to_wallet_address,
      changed_at
    )
    SELECT $1, $2, $3, 'registered', $4, $5, COALESCE($6, NOW())
    WHERE NOT EXISTS (
      SELECT 1
      FROM property_ownership_history
      WHERE property_id = $1
        AND change_type = 'registered'
    )
  `, [
    propertyRowId,
    property.id,
    property.certificateTokenId,
    registrationProfile.id,
    registrationWallet,
    property.createdAt,
  ]);

  stats.propertiesSynced += 1;
  return propertyRowId;
}

async function syncSale(client, registry, sale, propertyByScId, stats) {
  if (sale.status !== 'sold' || !isRealWallet(sale.buyer)) {
    return;
  }

  const property = propertyByScId.get(sale.propertyId);
  if (!property) return;

  const propertyResult = await client.query(
    'SELECT * FROM property WHERE sc_property_id = $1 LIMIT 1',
    [sale.propertyId],
  );
  if (propertyResult.rowCount === 0) return;

  const sellerProfile = await ensureProfileAndUser(client, registry, sale.seller, stats);
  const buyerProfile = await ensureProfileAndUser(client, registry, sale.buyer, stats);
  const propertyRow = propertyResult.rows[0];
  const syntheticTxHash = `ONCHAIN-SALE-${sale.id}`;
  const backendTransactionId = `ONCHAIN-SALE-${sale.id}`;

  await client.query(`
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
      fee_wei,
      status,
      create_tx_hash,
      release_tx_hash,
      created_at,
      released_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'released', $2, $2, COALESCE($14, NOW()), COALESCE($15, NOW()))
    ON CONFLICT (sc_sale_id)
    DO UPDATE SET
      property_id = EXCLUDED.property_id,
      seller_profile_id = EXCLUDED.seller_profile_id,
      buyer_profile_id = EXCLUDED.buyer_profile_id,
      seller_wallet_address = EXCLUDED.seller_wallet_address,
      buyer_wallet_address = EXCLUDED.buyer_wallet_address,
      price_wei = EXCLUDED.price_wei,
      document_hash = EXCLUDED.document_hash,
      fee_wei = EXCLUDED.fee_wei,
      status = 'released',
      released_at = COALESCE(transfer_contract.released_at, EXCLUDED.released_at),
      updated_at = NOW()
  `, [
    backendTransactionId,
    syntheticTxHash,
    sale.id,
    propertyRow.id,
    sale.propertyId,
    sale.certificateTokenId,
    sellerProfile.id,
    buyerProfile.id,
    sale.seller,
    sale.buyer,
    sale.priceWei,
    sale.documentHash,
    sale.feeWei,
    sale.createdAt,
    sale.releasedAt,
  ]);

  await client.query(`
    UPDATE property
    SET owner_profile_id = $1,
        owner_wallet_address = $2,
        asking_price_wei = $3,
        listing_status = 'sold',
        listing_sale_id = $4,
        sold_at = COALESCE(sold_at, $5),
        updated_at = NOW()
    WHERE id = $6
  `, [buyerProfile.id, sale.buyer, sale.priceWei, sale.id, sale.releasedAt, propertyRow.id]);

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
      tx_hash,
      changed_at
    )
    SELECT $1, $2, $3, 'transferred', $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW())
    WHERE NOT EXISTS (
      SELECT 1
      FROM property_ownership_history
      WHERE blockchain_sale_id = $8
        AND property_id = $1
        AND change_type = 'transferred'
    )
  `, [
    propertyRow.id,
    sale.propertyId,
    sale.certificateTokenId,
    sellerProfile.id,
    buyerProfile.id,
    sale.seller,
    sale.buyer,
    sale.id,
    backendTransactionId,
    syntheticTxHash,
    sale.releasedAt,
  ]);

  stats.salesSynced += 1;
}

async function main() {
  const registry = await getContract('registry');
  const escrow = await getContract('escrow');
  const propertyState = await readOnChainProperties(registry);
  const saleState = await readOnChainSales(escrow);
  const latestSaleByProperty = latestSaleStateByProperty(saleState.sales);
  const firstSoldByProperty = firstSoldSaleByProperty(saleState.sales);
  const propertyByScId = new Map(propertyState.properties.map((property) => [property.id, property]));

  const stats = {
    nextPropertyId: propertyState.nextPropertyId,
    nextSaleId: saleState.nextSaleId,
    profilesSynced: 0,
    profilesCreated: 0,
    propertiesSynced: 0,
    propertiesCreated: 0,
    propertiesUpdated: 0,
    salesSynced: 0,
  };

  await withTransaction(async (client) => {
    for (const property of propertyState.properties) {
      await ensureProfileAndUser(client, registry, property.createdBy, stats);
      await upsertProperty(
        client,
        registry,
        property,
        latestSaleByProperty.get(property.id),
        firstSoldByProperty.get(property.id),
        stats,
      );
    }

    for (const sale of saleState.sales) {
      await syncSale(client, registry, sale, propertyByScId, stats);
    }
  });

  console.log('On-chain sync completed');
  console.log(JSON.stringify(stats, null, 2));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
