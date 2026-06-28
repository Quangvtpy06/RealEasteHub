const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { query } = require('../db');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const artifactDir = process.env.ARTIFACT_DIR || path.join(projectRoot, 'artifacts');

const contracts = {
  nft: {
    env: 'NFT_ADDRESS',
    artifact: 'CertificateNFT.json',
    dbNames: ['CertificateNFT', 'PropertyCertificateNFT'],
  },
  registry: {
    env: 'REGISTRY_ADDRESS',
    artifact: 'PropertyRegistry.json',
    dbNames: ['PropertyRegistry'],
  },
  escrow: {
    env: 'ESCROW_ADDRESS',
    artifact: 'PropertyTransactionEscrow.json',
    dbNames: ['PropertyTransactionEscrow'],
  },
};

function loadAbi(key) {
  const config = contracts[key];
  const artifactPath = path.join(artifactDir, config.artifact);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
}

function getProvider() {
  if (!process.env.RPC_URL) {
    throw new Error('RPC_URL is required to connect backend with smart contracts');
  }

  return new ethers.JsonRpcProvider(process.env.RPC_URL);
}

function getSigner(provider) {
  if (!process.env.ADMIN_PRIVATE_KEY) {
    throw new Error('ADMIN_PRIVATE_KEY is required for write transactions');
  }

  return new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
}

async function resolveAddress(key) {
  const config = contracts[key];
  const envAddress = process.env[config.env];

  if (envAddress) {
    return envAddress;
  }

  const chainId = process.env.CHAIN_ID;
  const params = [config.dbNames];
  const chainFilter = chainId ? 'AND chain_id = $2' : '';

  if (chainId) {
    params.push(chainId);
  }

  const result = await query(`
    SELECT contract_address
    FROM contract_deployments
    WHERE active = TRUE
      AND contract_name = ANY($1)
      ${chainFilter}
    ORDER BY updated_at DESC
    LIMIT 1
  `, params);

  if (result.rowCount === 0) {
    throw new Error(`${config.env} is not configured and no active deployment was found`);
  }

  return result.rows[0].contract_address;
}

async function getContract(key, options = {}) {
  const provider = getProvider();
  const address = await resolveAddress(key);
  const runner = options.write ? getSigner(provider) : provider;
  return new ethers.Contract(address, loadAbi(key), runner);
}

function toBytes32(value) {
  const text = String(value ?? '').trim();

  if (/^0x[0-9a-fA-F]{64}$/.test(text)) {
    return text;
  }

  if (!text) {
    throw new Error('bytes32 value is required');
  }

  return ethers.id(text);
}

function toUint256FromHash(value) {
  return BigInt(toBytes32(value)).toString();
}

function serialize(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (value && typeof value === 'object') {
    const plain = typeof value.toObject === 'function' ? value.toObject() : value;
    const output = {};

    for (const [key, item] of Object.entries(plain)) {
      if (!/^\d+$/.test(key)) {
        output[key] = serialize(item);
      }
    }

    return output;
  }

  return value;
}

async function waitForTransaction(tx) {
  const receipt = await tx.wait();
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

async function getRuntimeConfig() {
  const provider = process.env.RPC_URL ? getProvider() : null;
  const network = provider ? await provider.getNetwork() : null;
  let feeRecipient = null;

  if (provider && process.env.ESCROW_ADDRESS) {
    try {
      const escrow = new ethers.Contract(process.env.ESCROW_ADDRESS, loadAbi('escrow'), provider);
      feeRecipient = await escrow.feeRecipient();
    } catch (error) {
      feeRecipient = null;
    }
  }

  return {
    rpcConfigured: Boolean(process.env.RPC_URL),
    adminSignerConfigured: Boolean(process.env.ADMIN_PRIVATE_KEY),
    chainId: network ? network.chainId.toString() : process.env.CHAIN_ID || null,
    addresses: {
      nft: process.env.NFT_ADDRESS || null,
      registry: process.env.REGISTRY_ADDRESS || null,
      escrow: process.env.ESCROW_ADDRESS || null,
    },
    feeRecipient,
  };
}

module.exports = {
  getContract,
  getProvider,
  getRuntimeConfig,
  resolveAddress,
  serialize,
  toBytes32,
  toUint256FromHash,
  waitForTransaction,
};
