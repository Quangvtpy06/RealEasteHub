function requirePinataJwt() {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    throw new Error('PINATA_JWT is required to upload files to IPFS');
  }

  return jwt;
}

function normalizeGateway(value = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/') {
  const trimmed = String(value || '').trim() || 'https://gateway.pinata.cloud/ipfs/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function cidToIpfsUri(cid, path = '') {
  const cleanPath = path ? `/${String(path).replace(/^\/+/, '')}` : '';
  return `ipfs://${cid}${cleanPath}`;
}

function ipfsToGatewayUrl(uriOrCid) {
  const value = String(uriOrCid || '').trim();

  if (!value) {
    return '';
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const withoutScheme = value.replace(/^ipfs:\/\//i, '').replace(/^\/?ipfs\//i, '');
  return `${normalizeGateway()}${withoutScheme}`;
}

async function parsePinataResponse(response) {
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail = payload.error?.details || payload.error || payload.message || text || response.statusText;
    throw new Error(`Pinata upload failed: ${detail}`);
  }

  return payload;
}

function extractCid(payload) {
  const cid = payload.IpfsHash || payload.cid || payload.CID || payload.data?.cid || payload.data?.IpfsHash;

  if (!cid) {
    throw new Error('Pinata response did not include a CID');
  }

  return cid;
}

async function uploadBufferToIPFS({ buffer, filename, mimeType, metadata = {} }) {
  requirePinataJwt();

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });

  form.append('file', blob, filename || 'upload.bin');
  form.append('pinataMetadata', JSON.stringify({
    name: filename || 'property-upload',
    keyvalues: metadata,
  }));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requirePinataJwt()}`,
    },
    body: form,
  });

  const payload = await parsePinataResponse(response);
  const cid = extractCid(payload);

  return {
    cid,
    uri: cidToIpfsUri(cid),
    gatewayUrl: ipfsToGatewayUrl(cid),
    raw: payload,
  };
}

async function uploadJsonToIPFS({ json, name, metadata = {} }) {
  requirePinataJwt();

  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requirePinataJwt()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: {
        name: name || 'property-metadata.json',
        keyvalues: metadata,
      },
    }),
  });

  const payload = await parsePinataResponse(response);
  const cid = extractCid(payload);

  return {
    cid,
    uri: cidToIpfsUri(cid),
    gatewayUrl: ipfsToGatewayUrl(cid),
    raw: payload,
  };
}

function getIpfsConfig() {
  return {
    pinataConfigured: Boolean(process.env.PINATA_JWT),
    gateway: normalizeGateway(),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  };
}

module.exports = {
  cidToIpfsUri,
  getIpfsConfig,
  ipfsToGatewayUrl,
  uploadBufferToIPFS,
  uploadJsonToIPFS,
};
