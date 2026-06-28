const NFT_ABI = [
  'function approve(address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)'
];

const REGISTRY_ABI = [
  'function registerProperty(bytes32 backendPropertyId, address initialOwner, bytes32 propertydataHash, bytes32 legalDocumentHash, string location, string certificateURI) returns (uint256 propertyId, uint256 tokenId)',
  'function propertyIdByBackend(bytes32 backendPropertyId) view returns (uint256)',
  'function getProperty(uint256 propertyId) view returns (tuple(uint256 id, bytes32 backendPropertyId, bytes32 propertydataHash, bytes32 legalDocumentHash, uint256 certificateTokenId, address currentOwner, address createdBy, string location, string certificateURI, bool active, uint256 createdAt, uint256 updatedAt))'
];

const ESCROW_ABI = [
  'function listCertificate(uint256 propertyId, uint256 priceWei, bytes32 backendTransactionId, bytes32 documentHash) returns (uint256)',
  'function createCertificateSale(uint256 propertyId, address buyer, uint256 priceWei, bytes32 backendTransactionId, bytes32 documentHash) returns (uint256)',
  'function buyCertificate(uint256 saleId) payable',
  'function depositCertificate(uint256 saleId) payable',
  'function cancelCertificateSale(uint256 saleId) external',
  'function getTransactionFee(uint256 priceWei) view returns (uint256)',
  'function getTotalPrice(uint256 priceWei) view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function saleIdByBackendTransactionId(bytes32 backendTransactionId) view returns (uint256)',
  'function getCertificateSale(uint256 saleId) view returns (tuple(uint256 id,uint256 propertyId,uint256 certificateTokenId,address seller,address buyer,uint256 priceWei,bytes32 backendTransactionId,bytes32 documentHash,uint8 status,uint256 createdAt,uint256 depositedAt,uint256 releasedAt,uint256 cancelledAt,address releasedBy))'
];

const MARKET_FEE_BPS = 100n;
const BPS_DENOMINATOR = 10000n;
const ETH_VND_RATE = 44742362.26;
const MOCK_EKYC_STORAGE_KEY = 'realEstateHubMockEkyc';

function getDefaultApiBase() {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:3000';
  }

  return window.location.origin;
}

function isNgrokHost(hostname) {
  return hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok-free.dev');
}

function getInitialApiBase() {
  const defaultBase = getDefaultApiBase();
  const savedBase = localStorage.getItem('propertyChainApiBase');

  if (!savedBase) {
    return defaultBase;
  }

  try {
    const savedUrl = new URL(savedBase);
    const currentUrl = new URL(defaultBase);

    if (isNgrokHost(currentUrl.hostname) && savedUrl.hostname !== currentUrl.hostname) {
      localStorage.setItem('propertyChainApiBase', defaultBase);
      return defaultBase;
    }

    if (savedUrl.hostname === currentUrl.hostname && savedUrl.port === '3000') {
      localStorage.setItem('propertyChainApiBase', defaultBase);
      return defaultBase;
    }
  } catch (error) {
    localStorage.setItem('propertyChainApiBase', defaultBase);
    return defaultBase;
  }

  return savedBase;
}

const state = {
  apiBase: getInitialApiBase(),
  account: null,
  chainId: null,
  contracts: null,
  profiles: [],
  properties: [],
  transfers: [],
  users: [],
  ledgerTransfers: [],
  ledgerOwnership: [],
  propertyImages: [],
  activeTable: 'profiles',
  page: 'home',
  mode: 'user',
  token: localStorage.getItem('propertyChainToken') || '',
  currentUser: null,
  setupAllowed: false,
  drawerWallet: '',
  pendingBuyPropertyId: '',
  slideshowImages: [],
  slideshowIndex: 0,
  detailGalleryImages: []
};

const allowedPages = ['home', 'profile', 'profiles', 'properties', 'transfers', 'ledger', 'verify', 'system'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function shortAddress(value) {
  if (!value) return '--';
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

function ipfsToGateway(uri) {
  if (!uri) return '';
  const value = String(uri).trim();
  if (/^https?:\/\//i.test(value)) return value;
  const gateway = state.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';
  const without = value.replace(/^ipfs:\/\//i, '').replace(/^\/?ipfs\//i, '');
  return gateway.endsWith('/') ? gateway + without : gateway + '/' + without;
}
function setDot(id, mode) {
  const element = $(id);
  element.classList.remove('idle', 'ok', 'warn', 'error');
  element.classList.add(mode);
}

function formatRole(role) {
  return role === 'admin' ? 'Quản trị viên' : role === 'user' ? 'Người dùng' : 'Khách';
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3600);
}

function logAction(title, detail = '') {
  const list = $('#activityLog');
  if (!list) return;

  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<strong>${title}</strong><small>${time}${detail ? ` - ${detail}` : ''}</small>`;
  list.prepend(item);
}

function collectForm(formSelector) {
  const form = $(formSelector);
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === 'string' ? value.trim() : value;
  });

  $$(`${formSelector} input[type="checkbox"]`).forEach((input) => {
    data[input.name] = input.checked;
  });

  return data;
}

async function api(path, options = {}) {
  const isFormDataBody = options.body instanceof FormData;
  const headers = {
    ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
    'ngrok-skip-browser-warning': 'true',
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${state.apiBase}${path}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

function requireEthers() {
  if (!window.ethers) {
    throw new Error('Không tải được ethers. Hãy kiểm tra file frontend/vendor/ethers.umd.min.js');
  }

  return window.ethers;
}

function requireAddress(value, name) {
  const ethers = requireEthers();
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} không phải địa chỉ ví hợp lệ`);
  }

  return value;
}

function toBytes32(value) {
  const ethers = requireEthers();
  const text = String(value || '').trim();

  if (/^0x[0-9a-fA-F]{64}$/.test(text)) {
    return text;
  }

  if (!text) {
    throw new Error('Giá trị bytes32 không được để trống');
  }

  return ethers.id(text);
}

function toUint256FromHash(value) {
  return BigInt(toBytes32(value));
}

function ethToWei(value, field = 'ETH') {
  const ethers = requireEthers();
  const text = String(value ?? '').trim();

  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new Error(`${field} phải là số ETH hợp lệ, tối đa 18 chữ số thập phân`);
  }

  return ethers.parseEther(text).toString();
}

function weiToEth(value) {
  const ethers = requireEthers();
  return ethers.formatEther(String(value || '0'));
}

function formatEthPrice(value) {
  const eth = weiToEth(value);
  return `${eth.replace(/\.?0+$/, '') || '0'} ETH`;
}

function ethNumberFromWei(value) {
  try {
    return Number(weiToEth(value || '0'));
  } catch (error) {
    return 0;
  }
}

function formatVndPrice(value) {
  const amount = ethNumberFromWei(value) * ETH_VND_RATE;
  return `${amount.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VND`;
}

function formatEthVndPrice(value) {
  const text = String(value || '0');
  return `${formatEthPrice(text)} · ${formatVndPrice(text)}`;
}

function formatListingPrice(value) {
  const text = String(value || '0');
  const label = formatEthVndPrice(text);

  if (BigInt(text) > 0n) {
    return label;
  }

  if (BigInt(text) <= 0n) {
    return 'Chưa niêm yết';
  }

  return label;
}

function calculateFeeWei(priceWei) {
  return ((BigInt(String(priceWei || '0')) * MARKET_FEE_BPS) / BPS_DENOMINATOR).toString();
}

function calculateTotalPriceWei(priceWei) {
  return (BigInt(String(priceWei || '0')) + BigInt(calculateFeeWei(priceWei))).toString();
}

function formatListingStatus(value) {
  const labels = {
    unlisted: 'Chưa niêm yết',
    listed: 'Đang bán',
    sold: 'Đã bán',
    cancelled: 'Đã hủy niêm yết'
  };

  return labels[value] || value || 'Chưa niêm yết';
}

function listingStatusClass(value) {
  if (value === 'listed') return 'listed';
  if (value === 'sold') return 'sold';
  if (value === 'cancelled') return 'cancelled';
  return 'unlisted';
}

async function getSigner() {
  const ethers = requireEthers();

  if (!window.ethereum) {
    throw new Error('Chrome chưa có MetaMask hoặc trang chưa được MetaMask cho phép kết nối');
  }

  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const provider = new ethers.BrowserProvider(window.ethereum);
  return provider.getSigner();
}

function getContractAddress(key) {
  const address = state.contracts?.addresses?.[key];

  if (!address) {
    throw new Error(`Backend chưa cấu hình ${key.toUpperCase()}_ADDRESS`);
  }

  return address;
}

async function getNftContract() {
  const ethers = requireEthers();
  return new ethers.Contract(getContractAddress('nft'), NFT_ABI, await getSigner());
}

async function getRegistryContract() {
  const ethers = requireEthers();
  return new ethers.Contract(getContractAddress('registry'), REGISTRY_ABI, await getSigner());
}

async function getEscrowContract() {
  const ethers = requireEthers();
  return new ethers.Contract(getContractAddress('escrow'), ESCROW_ABI, await getSigner());
}



function sameWallet(left, right) {
  return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
}

function getActiveWallet() {
  return state.account || state.currentUser?.walletAddress || state.currentUser?.wallet_address || '';
}

function currentChainIdDecimal() {
  if (!state.chainId) return null;

  try {
    return String(Number(state.chainId));
  } catch (error) {
    return String(state.chainId);
  }
}

function expectedChainIdDecimal() {
  return String(state.contracts?.chainId || '11155111');
}

function isExpectedNetwork() {
  return Boolean(state.chainId && currentChainIdDecimal() === expectedChainIdDecimal());
}

function getActiveProfile() {
  const wallet = getActiveWallet();
  if (!wallet) return null;
  return state.profiles.find((profile) => sameWallet(profile.wallet_address, wallet)) || null;
}

function getMockEkycStore() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_EKYC_STORAGE_KEY) || '{}') || {};
  } catch (error) {
    return {};
  }
}

function getMockEkycRecord(wallet = getActiveWallet()) {
  const key = String(wallet || '').toLowerCase();
  if (!key) return null;
  return getMockEkycStore()[key] || null;
}

function setMockEkycRecord(wallet, record) {
  const key = String(wallet || '').toLowerCase();
  if (!key) return;

  const store = getMockEkycStore();
  store[key] = record;
  localStorage.setItem(MOCK_EKYC_STORAGE_KEY, JSON.stringify(store));
}

function hasMockEkyc(wallet = getActiveWallet()) {
  const profile = wallet
    ? state.profiles.find((item) => sameWallet(item.wallet_address, wallet))
    : getActiveProfile();

  // Prefer server-side verified flag when available so other users see status
  if (profile && profile.verified) return true;

  return getMockEkycRecord(wallet)?.status === 'approved';
}

function isWalletEkycReady(wallet = getActiveWallet()) {
  const profile = wallet
    ? state.profiles.find((item) => sameWallet(item.wallet_address, wallet))
    : getActiveProfile();

  // If profile exists on backend and is verified, consider ready
  if (profile && profile.verified) return true;

  return Boolean(hasMockEkyc(wallet));
}

async function getConnectedWallet() {
  const signer = await getSigner();
  const address = await signer.getAddress();
  updateWalletUi(address, state.chainId);
  return address;
}

function updateWalletUi(address, chainId = state.chainId) {
  state.account = address || null;
  state.chainId = chainId || state.chainId;

  const walletStatus = $('#walletStatus');
  const walletInput = $('#walletAddressInput');
  const connectButton = $('#connectWalletBtn');

  if (walletStatus) walletStatus.textContent = shortAddress(state.account);
  if (walletInput) walletInput.value = state.account || '';
  if (connectButton) connectButton.textContent = state.account ? shortAddress(state.account) : 'Kết nối ví';
  if ($('#topbarAvatarText')) $('#topbarAvatarText').textContent = walletInitials(state.account);

  setDot('#walletDot', state.account ? 'ok' : 'warn');
  renderMetrics();
  renderProfilePage();
  renderHomeNfts();
  renderHomeDashboard();
  renderDataList();
}

async function connectWalletSilently() {
  if (!window.ethereum) return;

  const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
  const chainId = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => state.chainId);

  if (accounts[0]) {
    updateWalletUi(accounts[0], chainId);
  }
}

function walletInitials(wallet) {
  const text = shortAddress(wallet);
  if (!text || text === '--') return 'RH';
  return text.slice(2, 4).toUpperCase();
}

function formatWei(value) {
  if (!value) return '0 ETH';

  try {
    const ethers = window.ethers;
    if (ethers?.formatEther) {
      const formatted = Number(ethers.formatEther(String(value)));
      if (Number.isFinite(formatted)) {
        return `${formatted.toLocaleString('vi-VN', { maximumFractionDigits: 4 })} ETH`;
      }
    }
  } catch (error) {
    // Fallback below keeps the UI usable if ethers is unavailable.
  }

  return `${value} Wei`;
}

function getProfileData(walletOverride = '') {
  const wallet = walletOverride || getActiveWallet();
  const ownedNfts = state.ledgerOwnership.filter((item) => sameWallet(item.owner_wallet_address, wallet));
  const history = state.ledgerTransfers.filter((item) => (
    sameWallet(item.seller_wallet_address, wallet) || sameWallet(item.buyer_wallet_address, wallet)
  ));
  const totalWei = history.reduce((sum, item) => {
    try {
      return sum + BigInt(item.price_wei || 0);
    } catch (error) {
      return sum;
    }
  }, 0n);
  const totalFeesWei = state.ledgerTransfers.reduce((sum, item) => {
    try {
      return sum + BigInt(item.fee_wei || 0);
    } catch (error) {
      return sum;
    }
  }, 0n);

  return { wallet, ownedNfts, history, totalWei, totalFeesWei };
}

function isAdminProfileWallet(wallet) {
  return Boolean(state.currentUser?.role === 'admin' || sameWallet(wallet, state.contracts?.feeRecipient));
}

function profileMedia(item) {
  if (item.first_image_gateway_url) {
    return `<div class="profile-nft-media"><img src="${item.first_image_gateway_url}" alt="${item.location || 'Property NFT'}" loading="lazy" /></div>`;
  }

  return `<div class="profile-nft-media">NFT #${item.certificate_token_id ?? '--'}</div>`;
}

function renderProfilePage() {
  const profileRoot = $('#walletProfile');
  if (!profileRoot) return;

  const { wallet, ownedNfts, history, totalWei, totalFeesWei } = getProfileData();
  const displayName = state.currentUser?.displayName || state.currentUser?.username || 'Wallet holder';
  const adminProfile = isAdminProfileWallet(wallet);

  $('#profileAvatar').textContent = walletInitials(wallet);
  $('#profileGreeting').textContent = wallet ? `Hi, ${shortAddress(wallet)}` : `Hi, ${displayName}`;
  $('#profileWalletLine').textContent = wallet
    ? `${displayName} · ${wallet}`
    : 'Kết nối MetaMask để xem NFT, token và lịch sử giao dịch của ví.';
  $('#profileOwnedCount').textContent = ownedNfts.length;
  $('#profileTokenCount').textContent = ownedNfts.filter((item) => item.certificate_token_id !== null && item.certificate_token_id !== undefined).length;
  $('#profileHistoryCount').textContent = history.length;
  $('#profileValueLabel').textContent = adminProfile ? 'Total Fees' : 'Recorded Value';
  $('#profileValueHelp').textContent = adminProfile ? 'Tổng phí giao dịch marketplace ví admin đã nhận' : 'Tổng giá trị giao dịch đã ghi nhận';
  $('#profileTotalValue').textContent = formatWei((adminProfile ? totalFeesWei : totalWei).toString());

  const nftGrid = $('#profileNftGrid');
  if (ownedNfts.length) {
    nftGrid.innerHTML = ownedNfts.map((item) => `
      <article class="profile-nft-card">
        ${profileMedia(item)}
        <div class="profile-nft-body">
          <strong>${item.location || 'Property certificate'}</strong>
          <small>tokenId: #${item.certificate_token_id ?? '--'} · propertyId: ${item.sc_property_id ?? '--'}</small>
          <small>Chủ sở hữu: ${item.owner_full_name || shortAddress(item.owner_wallet_address)}</small>
          <small>${item.certificate_uri || 'Chưa có tokenURI'}</small>
        </div>
      </article>
    `).join('');
  } else {
    nftGrid.innerHTML = `
      <div class="profile-empty">
        <strong>Chưa có NFT trong ví này</strong>
        <small>Sau khi mint hoặc nhận chuyển nhượng NFT giấy chứng nhận, tài sản sẽ xuất hiện tại đây.</small>
      </div>
    `;
  }

  const tokenList = $('#profileTokenList');
  if (ownedNfts.length) {
    tokenList.innerHTML = ownedNfts.map((item) => `
      <article class="profile-token-item">
        <div>
          <strong>${item.location || 'Property certificate'}</strong>
          <small>SC propertyId: ${item.sc_property_id ?? '--'} · Hồ sơ DB: #${item.property_id ?? '--'}</small>
        </div>
        <span class="profile-token-id">#${item.certificate_token_id ?? '--'}</span>
      </article>
    `).join('');
  } else {
    tokenList.innerHTML = `
      <div class="profile-empty">
        <strong>Không có token certificate</strong>
        <small>Danh sách token lấy từ NFT đang thuộc quyền sở hữu của ví đăng nhập.</small>
      </div>
    `;
  }

  const historyList = $('#profileHistoryList');
  if (history.length) {
    historyList.innerHTML = history.map((item) => `
      <article class="profile-history-item">
        <strong>#${item.id} · ${formatStatus(item.status)} · ${item.location || 'Property transfer'}</strong>
        <small>${item.seller_full_name || shortAddress(item.seller_wallet_address)} → ${item.buyer_full_name || shortAddress(item.buyer_wallet_address)}</small>
        <small>Giá trị: ${formatWei(item.price_wei)} · saleId: ${item.sc_sale_id ?? '--'} · tokenId: ${item.certificate_token_id ?? '--'}</small>
        <small>Release tx: ${txLink(item.release_tx_hash)} · Cập nhật: ${formatDateTime(item.updated_at)}</small>
      </article>
    `).join('');
  } else {
    historyList.innerHTML = `
      <div class="profile-empty">
        <strong>Chưa có lịch sử giao dịch</strong>
        <small>Khi ví này mua, bán hoặc nhận NFT certificate, lịch sử sẽ được ghi tại đây.</small>
      </div>
    `;
  }
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function riskStatusLabel(item) {
  if (!item) return '--';
  return item.active ? 'Đang hoạt động' : 'Đã khóa';
}

function riskReason(item) {
  return item?.risk_reason || item?.suspensionReason || item?.suspension_reason || '';
}

function isPropertyBlocked(item) {
  return !item?.active || item?.risk_status === 'blocked';
}

function fillRiskUser(userId) {
  const input = $('#riskUserForm [name="user_id"]');
  if (input) input.value = userId || '';
  setPage('system');
}

function fillRiskNft(propertyId) {
  const input = $('#riskNftForm [name="property_id"]');
  if (input) input.value = propertyId || '';
  setPage('system');
}

function renderRiskAdmin() {
  const container = $('#riskAdminList');
  if (!container) return;

  if (state.mode !== 'admin') {
    container.innerHTML = '';
    return;
  }

  const users = state.users.slice(0, 8);
  const properties = state.properties.slice(0, 8);

  const usersHtml = users.length ? users.map((user) => `
    <article class="risk-item ${user.active ? '' : 'risk-item-blocked'}">
      <div>
        <strong>#${escapeHtml(user.id)} - ${escapeHtml(user.displayName || user.username || 'User')}</strong>
        <small>${escapeHtml(shortAddress(user.walletAddress || user.wallet_address))} · ${escapeHtml(user.role || 'user')} · ${escapeHtml(user.active ? 'active' : 'blocked')}</small>
        ${riskReason(user) ? `<small>Lý do: ${escapeHtml(riskReason(user))}</small>` : ''}
      </div>
      <button class="text-button" type="button" data-risk-user="${escapeHtml(user.id)}">Chọn</button>
    </article>
  `).join('') : '<div class="data-item"><strong>Chưa có user</strong><small>Bấm Làm mới để tải danh sách tài khoản.</small></div>';

  const propertiesHtml = properties.length ? properties.map((item) => `
    <article class="risk-item ${isPropertyBlocked(item) ? 'risk-item-blocked' : ''}">
      <div>
        <strong>#${escapeHtml(item.id)} - ${escapeHtml(item.location || 'Property NFT')}</strong>
        <small>tokenId: ${escapeHtml(item.certificate_token_id ?? '--')} · owner: ${escapeHtml(item.owner_full_name || shortAddress(item.owner_wallet_address))}</small>
        <small>${escapeHtml(riskStatusLabel(item))} · Listing: ${escapeHtml(formatListingStatus(item.listing_status))}</small>
        ${riskReason(item) ? `<small>Lý do: ${escapeHtml(riskReason(item))}</small>` : ''}
      </div>
      <button class="text-button" type="button" data-risk-property="${escapeHtml(item.id)}">Chọn</button>
    </article>
  `).join('') : '<div class="data-item"><strong>Chưa có NFT</strong><small>Bấm Làm mới để tải danh sách tài sản.</small></div>';

  container.innerHTML = `
    <section>
      <h3>User gần đây</h3>
      <div class="risk-list">${usersHtml}</div>
    </section>
    <section>
      <h3>NFT / tài sản gần đây</h3>
      <div class="risk-list">${propertiesHtml}</div>
    </section>
  `;
}

function nftImageMarkup(item, className, label = 'NFT') {
  const image = item.first_image_gateway_url || item.gateway_url;

  if (image) {
    return `<div class="${className}"><img src="${escapeHtml(image)}" alt="${escapeHtml(item.location || label)}" loading="lazy" /></div>`;
  }

  return `<div class="${className}">NFT #${escapeHtml(item.certificate_token_id ?? '--')}</div>`;
}

function profileNameForWallet(wallet) {
  const profile = state.profiles.find((item) => sameWallet(item.wallet_address, wallet));
  return profile?.full_name || shortAddress(wallet);
}

function setDrawerTab(tabId) {
  $$('.drawer-pane').forEach((pane) => {
    pane.hidden = pane.id !== tabId;
  });

  $$('[data-drawer-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.drawerTab === tabId);
  });
}

function isProfileDrawerOpen() {
  const drawer = $('#profileDrawer');
  return Boolean(drawer && !drawer.hidden);
}

function openProfileDrawer(wallet = '') {
  state.drawerWallet = wallet || getActiveWallet();
  renderProfileDrawer();

  const backdrop = $('#profileDrawerBackdrop');
  const drawer = $('#profileDrawer');
  if (backdrop) backdrop.hidden = false;
  if (drawer) drawer.hidden = false;

  setDrawerTab('drawerNfts');
}

function closeProfileDrawer() {
  const backdrop = $('#profileDrawerBackdrop');
  const drawer = $('#profileDrawer');

  if (backdrop) backdrop.hidden = true;
  if (drawer) drawer.hidden = true;

  state.drawerWallet = '';
}

function toggleProfileDrawer(wallet = '') {
  if (isProfileDrawerOpen()) {
    closeProfileDrawer();
    return;
  }

  openProfileDrawer(wallet);
}

function drawerEmpty(title, detail) {
  return `
    <article class="drawer-item">
      <div class="drawer-item-body">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
    </article>
  `;
}

function renderProfileDrawer() {
  const drawer = $('#profileDrawer');
  if (!drawer) return;

  const wallet = state.drawerWallet || getActiveWallet();
  const { ownedNfts, history, totalWei, totalFeesWei } = getProfileData(wallet);
  const adminProfile = isAdminProfileWallet(wallet);
  const title = wallet ? `Hi, ${shortAddress(wallet)}` : 'Hi, wallet holder';

  $('#drawerAvatar').textContent = walletInitials(wallet);
  $('#drawerTitle').textContent = title;
  $('#drawerWallet').textContent = wallet ? `${profileNameForWallet(wallet)} · ${wallet}` : 'Kết nối ví để xem profile';
  $('#drawerOwnedCount').textContent = ownedNfts.length;
  $('#drawerTotalLabel').textContent = adminProfile ? 'Total Fees' : 'Total Value';
  $('#drawerTotalValue').textContent = formatWei((adminProfile ? totalFeesWei : totalWei).toString());

  $('#drawerNftList').innerHTML = ownedNfts.length ? ownedNfts.map((item) => `
    <article class="drawer-item">
      ${nftImageMarkup(item, 'drawer-item-media', 'Property NFT')}
      <div class="drawer-item-body">
        <strong>${escapeHtml(item.location || 'Property certificate')}</strong>
        <small>tokenId: #${escapeHtml(item.certificate_token_id ?? '--')} · propertyId: ${escapeHtml(item.sc_property_id ?? '--')}</small>
        <small>${escapeHtml(item.certificate_uri || 'Chưa có tokenURI')}</small>
      </div>
    </article>
  `).join('') : drawerEmpty('No NFTs yet', 'Ví này chưa sở hữu NFT certificate nào trong hệ thống.');

  $('#drawerTokenList').innerHTML = ownedNfts.length ? ownedNfts.map((item) => `
    <article class="drawer-item">
      <div class="drawer-item-body">
        <strong>Token #${escapeHtml(item.certificate_token_id ?? '--')}</strong>
        <small>${escapeHtml(item.location || 'Property certificate')}</small>
        <small>SC propertyId: ${escapeHtml(item.sc_property_id ?? '--')} · Hồ sơ: #${escapeHtml(item.property_id ?? '--')}</small>
      </div>
    </article>
  `).join('') : drawerEmpty('No tokens', 'Token certificate sẽ xuất hiện sau khi mint hoặc nhận chuyển nhượng.');

  $('#drawerHistoryList').innerHTML = history.length ? history.map((item) => `
    <article class="drawer-item">
      <div class="drawer-item-body">
        <strong>#${escapeHtml(item.id)} · ${escapeHtml(formatStatus(item.status))}</strong>
        <small>${escapeHtml(item.seller_full_name || shortAddress(item.seller_wallet_address))} → ${escapeHtml(item.buyer_full_name || shortAddress(item.buyer_wallet_address))}</small>
        <small>${escapeHtml(item.location || 'Property transfer')} · ${escapeHtml(formatWei(item.price_wei))}</small>
        <small>Cập nhật: ${escapeHtml(formatDateTime(item.updated_at))}</small>
      </div>
    </article>
  `).join('') : drawerEmpty('No history', 'Chưa có giao dịch nào liên quan đến ví này.');
}

function renderHomeNfts() {
  const grid = $('#homeNftGrid');
  if (!grid) return;

  const sourceItems = state.ledgerOwnership.length ? state.ledgerOwnership : state.properties.map((item) => ({
    property_id: item.id,
    certificate_token_id: item.certificate_token_id,
    sc_property_id: item.sc_property_id,
    location: item.location,
    certificate_uri: item.certificate_uri,
    owner_full_name: item.owner_full_name,
    owner_wallet_address: item.owner_wallet_address,
    first_image_gateway_url: item.first_image_gateway_url,
    asking_price_wei: item.asking_price_wei,
    listing_status: item.listing_status,
    listing_sale_id: item.listing_sale_id,
    listing_tx_hash: item.listing_tx_hash
  }));
  const items = sourceItems.filter((item) => item.active !== false && item.listing_status === 'listed' && item.listing_sale_id);

  if (!items.length) {
    grid.innerHTML = `
      <div class="profile-empty">
        <strong>Chưa có NFT đang bán</strong>
        <small>Seller mint NFT xong cần list thì NFT mới xuất hiện trên marketplace.</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map((item) => {
    const priceWei = item.asking_price_wei || '0';
    const feeWei = calculateFeeWei(priceWei);
    const totalWei = calculateTotalPriceWei(priceWei);

    return `
      <article class="market-nft-card">
        ${nftImageMarkup(item, 'market-nft-media', 'Property NFT')}
        <div class="market-nft-body">
          <strong>${escapeHtml(item.location || 'Property certificate')}</strong>
          <small>tokenId: #${escapeHtml(item.certificate_token_id ?? '--')} · propertyId: ${escapeHtml(item.sc_property_id ?? '--')}</small>
          <small>Giá bán: ${escapeHtml(priceWei && priceWei !== '0' ? formatEthPrice(priceWei) : 'Chưa niêm yết')}</small>
          <small>${escapeHtml(item.certificate_uri || 'Chưa có tokenURI')}</small>
          <small>Phí admin 1%: ${escapeHtml(formatEthPrice(feeWei))} · Buyer trả: ${escapeHtml(formatEthPrice(totalWei))}</small>
          <div class="market-nft-owner">
            <small>Owner: ${escapeHtml(item.owner_full_name || shortAddress(item.owner_wallet_address))}</small>
            <button class="text-button" type="button" data-open-wallet="${escapeHtml(item.owner_wallet_address || '')}">Profile</button>
            <button class="text-button" type="button" data-buy-property="${escapeHtml(item.property_id || item.id || '')}">Mua ngay</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderHomeNfts() {
  const grid = $('#homeNftGrid');
  if (!grid) return;

  const sourceItems = state.ledgerOwnership.length ? state.ledgerOwnership : state.properties.map((item) => ({
    property_id: item.id,
    id: item.id,
    certificate_token_id: item.certificate_token_id,
    sc_property_id: item.sc_property_id,
    location: item.location,
    certificate_uri: item.certificate_uri,
    property_data_hash: item.property_data_hash,
    legal_document_hash: item.legal_document_hash,
    owner_full_name: item.owner_full_name,
    owner_wallet_address: item.owner_wallet_address,
    first_image_gateway_url: item.first_image_gateway_url,
    asking_price_wei: item.asking_price_wei,
    listing_status: item.listing_status,
    listing_sale_id: item.listing_sale_id,
    listing_tx_hash: item.listing_tx_hash,
    active: item.active
  }));
  const items = sourceItems
    .filter((item) => item.active !== false)
    .sort((a, b) => {
      const priority = { listed: 0, unlisted: 1, sold: 2, cancelled: 3 };
      return (priority[a.listing_status] ?? 4) - (priority[b.listing_status] ?? 4);
    })
    .slice(0, 6);

  if (!items.length) {
    grid.innerHTML = `
      <div class="profile-empty">
        <strong>Chưa có NFT để hiển thị</strong>
        <small>Seller mint NFT xong cần list thì NFT mới xuất hiện như tài sản đang bán trên Marketplace.</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map((item) => {
    const priceWei = item.asking_price_wei || '0';
    const feeWei = calculateFeeWei(priceWei);
    const totalWei = calculateTotalPriceWei(priceWei);
    const propertyId = item.property_id || item.id || '';
    const listed = item.listing_status === 'listed' && item.listing_sale_id;

    return `
      <article class="market-nft-card" data-property-detail="${escapeHtml(propertyId)}">
        ${nftImageMarkup(item, 'market-nft-media', 'Property NFT')}
        <div class="market-nft-body">
          <div class="market-card-topline">
            <span class="listing-badge ${escapeHtml(listingStatusClass(item.listing_status))}">${escapeHtml(formatListingStatus(item.listing_status))}</span>
            <small>#${escapeHtml(item.certificate_token_id ?? '--')}</small>
          </div>
          <strong>${escapeHtml(item.location || 'Property certificate')}</strong>
          <small>propertyId: ${escapeHtml(item.sc_property_id ?? '--')} · owner ${escapeHtml(item.owner_full_name || shortAddress(item.owner_wallet_address))}</small>
          <small>Giá hiển thị: ${escapeHtml(formatListingPrice(priceWei))}</small>
          <small>Phí 1%: ${escapeHtml(formatEthVndPrice(feeWei))} · Buyer trả: ${escapeHtml(formatEthVndPrice(totalWei))}</small>
          <div class="market-nft-owner">
            <button class="text-button" type="button" data-open-wallet="${escapeHtml(item.owner_wallet_address || '')}">Profile</button>
            <button class="text-button" type="button" data-property-detail="${escapeHtml(propertyId)}">Chi tiết</button>
            ${listed ? `<button class="text-button" type="button" data-buy-property="${escapeHtml(propertyId)}">Mua ngay</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function findNftItemByPropertyId(propertyId) {
  return state.ledgerOwnership.find((item) => String(item.property_id) === String(propertyId))
    || state.properties.find((item) => String(item.id) === String(propertyId));
}

function getPropertyDetailItem(propertyId) {
  const ledgerItem = state.ledgerOwnership.find((item) => String(item.property_id) === String(propertyId)) || {};
  const propertyItem = state.properties.find((item) => String(item.id) === String(propertyId)) || {};

  return {
    ...propertyItem,
    ...ledgerItem,
    id: propertyItem.id || ledgerItem.property_id,
    property_id: ledgerItem.property_id || propertyItem.id,
    property_data_hash: propertyItem.property_data_hash || ledgerItem.property_data_hash,
    legal_document_hash: propertyItem.legal_document_hash || ledgerItem.legal_document_hash,
    backend_property_id: propertyItem.backend_property_id || ledgerItem.backend_property_id,
  };
}

function detailRow(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? '--')}</strong>
    </div>
  `;
}

function propertySpecValue(value, fallback = 'Chưa cập nhật') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function propertyMapsUrl(item) {
  const raw = item.google_maps_url || item.maps_url || item.location || '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw || 'Thu Duc Ho Chi Minh City')}`;
}

function propertyGalleryItems(item, images = []) {
  const gallery = images.length ? images : [];

  if (!gallery.length && item.first_image_gateway_url) {
    gallery.push({
      gateway_url: item.first_image_gateway_url,
      caption: item.location || 'Ảnh tài sản'
    });
  }

  return gallery.slice(0, 6);
}

function isPropertyDocumentUnlocked(item) {
  return sameWallet(getActiveWallet(), item.owner_wallet_address);
}

function findUploadedDocument(images, keyword, excludeIds = []) {
  if (!Array.isArray(images) || !images.length) return null;
  const normalizedKeyword = keyword.toLowerCase();
  const candidates = images.filter((img) => !excludeIds.includes(img.id));

  // Ưu tiên tìm theo caption (vd: "Legal document", "Valuation report")
  const byCaption = candidates.find((img) => String(img.caption || '').toLowerCase().includes(normalizedKeyword));
  if (byCaption) return byCaption;

  // Fallback: tìm theo mime_type pdf nếu caption không khớp (vd: caption bị ghi đè bởi ô "Chú thích ảnh" chung)
  return candidates.find((img) => String(img.mime_type || '').toLowerCase().includes('pdf')) || null;
}

async function downloadFileAsBlob(url, fileName) {
  if (!url) {
    showToast('Chưa có file để tải.');
    return;
  }

  try {
    const response = await fetch(url, { mode: 'cors' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = blobUrl;
    link.download = fileName || 'document.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error('downloadFileAsBlob failed', error);
    // Fallback: mở tab mới nếu fetch bị chặn (vd: CORS từ gateway)
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast('Không thể tải trực tiếp (CORS), đã mở file ở tab mới. Hãy dùng "Lưu thành" trên tab đó.');
  }
}

function propertyHistoryForItem(item) {
  const propertyId = String(item.property_id || item.id || '');
  const scPropertyId = String(item.sc_property_id ?? '');
  const tokenId = String(item.certificate_token_id ?? '');

  return state.ledgerTransfers.filter((transfer) => (
    (propertyId && String(transfer.property_id || '') === propertyId)
    || (scPropertyId && String(transfer.sc_property_id || '') === scPropertyId)
    || (tokenId && String(transfer.certificate_token_id || '') === tokenId)
  ));
}

function renderPropertyGallery(item, images = []) {
  const gallery = propertyGalleryItems(item, images);
  state.detailGalleryImages = gallery;

  if (!gallery.length) {
    return `
      <div class="asset-gallery-empty">
        <strong>Chưa có ảnh tài sản</strong>
        <small>Upload ảnh IPFS ở phần Bất động sản để hiển thị thư viện.</small>
      </div>
    `;
  }

  return gallery.map((image, index) => `
    <figure class="asset-gallery-card ${index === 0 ? 'featured' : ''}">
      <button class="asset-gallery-trigger" type="button" data-slideshow-source="detailGallery" data-slideshow-index="${index}">
        <img src="${escapeHtml(image.gateway_url)}" alt="${escapeHtml(image.caption || image.original_name || item.location || 'Property image')}" loading="lazy" />
      </button>
      <figcaption>${escapeHtml(image.caption || image.original_name || `Ảnh ${index + 1}`)}</figcaption>
    </figure>
  `).join('');
}

function legalFileCard({ title, detail, href, fileName = '', locked = false }) {
  const hasFile = Boolean(href);
  const downloadName = fileName || `${title || 'document'}.pdf`;
  const action = locked
    ? '<span class="legal-file-action">Bị khóa</span>'
    : hasFile
      ? `<button class="legal-file-action" type="button" data-download-file="${escapeHtml(href)}" data-download-name="${escapeHtml(downloadName)}">Tải PDF</button>`
      : '<span class="legal-file-action">Chưa có file</span>';

  return `
    <article class="legal-file-card ${locked ? 'locked' : ''}">
      <div class="legal-file-preview">
        <span>PDF</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${action}
    </article>
  `;
}

function renderPropertyHistoryTable(item) {
  const rows = propertyHistoryForItem(item);

  if (!rows.length) {
    return `
      <div class="asset-history-empty">
        <strong>Chưa có giao dịch</strong>
        <small>Lịch sử mua bán sẽ xuất hiện sau khi NFT được giao dịch thành công.</small>
      </div>
    `;
  }

  return `
    <div class="asset-history-table">
      <table>
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Trạng thái</th>
            <th>Người bán</th>
            <th>Người mua</th>
            <th>Giá trị</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(formatDateTime(row.updated_at || row.created_at))}</td>
              <td>${escapeHtml(formatStatus(row.status))}</td>
              <td>${escapeHtml(row.seller_full_name || shortAddress(row.seller_wallet_address))}</td>
              <td>${escapeHtml(row.buyer_full_name || shortAddress(row.buyer_wallet_address))}</td>
              <td>${escapeHtml(formatEthVndPrice(row.price_wei || '0'))}</td>
              <td>${txLink(row.release_tx_hash || row.buy_tx_hash || row.deposit_tx_hash || row.sale_tx_hash)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPropertyDetailContent(item, images = []) {
  const priceWei = item.asking_price_wei || '0';
  const feeWei = calculateFeeWei(priceWei);
  const totalWei = calculateTotalPriceWei(priceWei);
  const listed = item.listing_status === 'listed' && item.listing_sale_id;
  const unlocked = isPropertyDocumentUnlocked(item);
  const nftAddress = state.contracts?.addresses?.nft || '--';
  const network = `Sepolia Testnet · Chain ${state.contracts?.chainId || '11155111'}`;

  return `
    <div class="asset-profile-detail">
      <div class="property-detail-title asset-profile-title">
        <span class="listing-badge ${escapeHtml(listingStatusClass(item.listing_status))}">${escapeHtml(formatListingStatus(item.listing_status))}</span>
        <h2>${escapeHtml(item.location || 'Hồ sơ tài sản')}</h2>
        <p>${escapeHtml(item.backend_property_id || `PROPERTY-${item.property_id || item.id}`)}</p>
      </div>

      <div class="property-detail-tabs">
        <button class="active" type="button">Tab 1 · Hồ sơ tài sản</button>
      </div>

      <section class="asset-profile-section asset-profile-gallery">
        <div class="asset-section-heading">
          <span>01</span>
          <div>
            <h3>Thư viện ảnh & thông số nhà</h3>
            <small>Ảnh NFT/tài sản, diện tích, số phòng và vị trí Google Maps.</small>
          </div>
        </div>
        <div class="asset-gallery-grid">
          ${renderPropertyGallery(item, images)}
        </div>
        <div class="property-detail-grid asset-spec-grid">
          ${detailRow('Diện tích', propertySpecValue(item.area_m2 || item.area || item.land_area, 'Chưa cập nhật'))}
          ${detailRow('Số phòng', propertySpecValue(item.rooms || item.bedrooms || item.room_count, 'Chưa cập nhật'))}
          ${detailRow('Địa chỉ', item.location || '--')}
          <div>
            <span>Google Maps</span>
            <strong><a href="${escapeHtml(propertyMapsUrl(item))}" target="_blank" rel="noreferrer">Mở bản đồ</a></strong>
          </div>
        </div>
      </section>

      <section class="asset-profile-section">
        <div class="asset-section-heading">
          <span>02</span>
          <div>
            <h3>File pháp lý</h3>
            <small>Sổ đỏ được che mờ cho tới khi ví hiện tại nắm giữ NFT.</small>
          </div>
        </div>
        <div class="legal-file-grid">
          ${(() => {
            const legalDoc = findUploadedDocument(images, 'legal');
            const valuationDoc = findUploadedDocument(images, 'valuation', legalDoc ? [legalDoc.id] : []);
            return `
              ${legalFileCard({
                title: 'Sổ đỏ',
                detail: unlocked ? 'Đã mở khóa vì ví hiện tại là owner NFT.' : 'Chỉ owner NFT mới xem được bản rõ nét.',
                href: unlocked ? ipfsToGateway(legalDoc?.image_uri || legalDoc?.gateway_url) : '',
                fileName: legalDoc?.original_name || 'so-do.pdf',
                locked: !unlocked
              })}
              ${legalFileCard({
                title: 'Thẩm định giá',
                detail: 'Tài liệu thẩm định/metadata của tài sản.',
                href: ipfsToGateway(valuationDoc?.image_uri || valuationDoc?.gateway_url),
                fileName: valuationDoc?.original_name || 'tham-dinh-gia.pdf',
                locked: false
              })}
            `;
          })()}
        </div>
      </section>

      <section class="asset-profile-section">
        <div class="asset-section-heading">
          <span>03</span>
          <div>
            <h3>Thông tin On-chain</h3>
            <small>Thông tin NFT certificate đang ghi nhận trên testnet.</small>
          </div>
        </div>
        <div class="property-detail-price asset-price-box">
          <span>Giá hiển thị</span>
          <strong>${escapeHtml(formatListingPrice(priceWei))}</strong>
          <small>Phí marketplace 1%: ${escapeHtml(formatEthVndPrice(feeWei))} · Buyer thanh toán: ${escapeHtml(formatEthVndPrice(totalWei))}</small>
        </div>
        <div class="property-detail-grid asset-chain-grid">
          ${detailRow('Contract Address', shortAddress(nftAddress))}
          ${detailRow('Token ID', item.certificate_token_id ?? '--')}
          ${detailRow('Mạng Testnet', network)}
          <div>
            <span>Link IPFS</span>
            <strong><a href="${escapeHtml(ipfsToGateway(item.certificate_uri) || '#')}" target="_blank" rel="noreferrer">${escapeHtml(item.certificate_uri || '--')}</a></strong>
          </div>
          ${detailRow('SC propertyId', item.sc_property_id ?? '--')}
          ${detailRow('Owner', item.owner_full_name || shortAddress(item.owner_wallet_address))}
        </div>
      </section>

      <section class="asset-profile-section asset-history-section">
        <div class="asset-section-heading">
          <span>04</span>
          <div>
            <h3>Lịch sử giao dịch</h3>
            <small>Ghi nhận các giao dịch mua bán liên quan tới NFT này.</small>
          </div>
        </div>
        ${renderPropertyHistoryTable(item)}
      </section>

      <div class="button-row wrap">
        <button class="button secondary" type="button" data-open-wallet="${escapeHtml(item.owner_wallet_address || '')}">Xem owner</button>
        ${listed ? `<button class="button primary" type="button" data-buy-property="${escapeHtml(item.property_id || item.id)}">Mua ngay</button>` : ''}
      </div>
    </div>
  `;
}

function closePropertyDetail() {
  const backdrop = $('#propertyDetailBackdrop');
  const modal = $('#propertyDetailModal');
  if (backdrop) backdrop.hidden = true;
  if (modal) modal.hidden = true;
}

function openPropertyDetail(propertyId) {
  const item = getPropertyDetailItem(propertyId);
  const modal = $('#propertyDetailModal');
  const backdrop = $('#propertyDetailBackdrop');
  const content = $('#propertyDetailContent');
  content.classList.add('asset-profile-content');

  if (!item.property_id && !item.id) {
    showToast('Không tìm thấy chi tiết tài sản');
    return;
  }

  const priceWei = item.asking_price_wei || '0';
  const feeWei = calculateFeeWei(priceWei);
  const totalWei = calculateTotalPriceWei(priceWei);
  const listed = item.listing_status === 'listed' && item.listing_sale_id;

  content.innerHTML = `
    <div class="property-detail-media">
      ${nftImageMarkup(item, 'property-detail-image', 'Property NFT')}
    </div>
    <div class="property-detail-main">
      <div class="property-detail-title">
        <span class="listing-badge ${escapeHtml(listingStatusClass(item.listing_status))}">${escapeHtml(formatListingStatus(item.listing_status))}</span>
        <h2>${escapeHtml(item.location || 'Property certificate')}</h2>
        <p>${escapeHtml(item.backend_property_id || `PROPERTY-${item.property_id || item.id}`)}</p>
      </div>
      <div class="property-detail-price">
        <span>Giá hiển thị</span>
        <strong>${escapeHtml(formatListingPrice(priceWei))}</strong>
        <small>Phí marketplace 1%: ${escapeHtml(formatEthVndPrice(feeWei))} · Buyer thanh toán: ${escapeHtml(formatEthVndPrice(totalWei))}</small>
      </div>
      <div class="property-detail-grid">
        ${detailRow('Token ID', item.certificate_token_id ?? '--')}
        ${detailRow('SC propertyId', item.sc_property_id ?? '--')}
        ${detailRow('Owner', item.owner_full_name || shortAddress(item.owner_wallet_address))}
        ${detailRow('Owner wallet', shortAddress(item.owner_wallet_address))}
        ${detailRow('Listing saleId', item.listing_sale_id ?? '--')}
        ${detailRow('Transfer count', item.total_changes ?? 0)}
      </div>
      <div class="property-detail-docs">
        <strong>Hồ sơ pháp lý</strong>
        <a href="${escapeHtml(ipfsToGateway(item.certificate_uri) || '#')}" target="_blank" rel="noreferrer">Certificate / Token URI</a>
        <small>Property data hash: ${escapeHtml(item.property_data_hash || '--')}</small>
        <small>Legal document hash: ${escapeHtml(item.legal_document_hash || '--')}</small>
      </div>
      <div class="button-row wrap">
        <button class="button secondary" type="button" data-open-wallet="${escapeHtml(item.owner_wallet_address || '')}">Xem owner</button>
        ${listed ? `<button class="button primary" type="button" data-buy-property="${escapeHtml(item.property_id || item.id)}">Mua ngay</button>` : ''}
      </div>
    </div>
  `;

  content.innerHTML = renderPropertyDetailContent(item);

  if (backdrop) backdrop.hidden = false;
  if (modal) modal.hidden = false;

  const propertyIdForImages = item.property_id || item.id;
  if (propertyIdForImages) {
    api(`/api/properties/${propertyIdForImages}/images`)
      .then((payload) => {
        content.innerHTML = renderPropertyDetailContent(item, payload.data || []);
      })
      .catch(() => {
        content.innerHTML = renderPropertyDetailContent(item);
      });
  }
}

function closeMockEkycModal({ clearPending = true } = {}) {
  const backdrop = $('#mockEkycBackdrop');
  const modal = $('#mockEkycModal');
  const form = $('#mockEkycForm');

  if (clearPending) state.pendingBuyPropertyId = '';
  if (form) form.reset();
  if (backdrop) backdrop.hidden = true;
  if (modal) modal.hidden = true;
}

function openMockEkycModal({ propertyId = '', resumeBuy = false } = {}) {
  const wallet = getActiveWallet();
  const profile = getActiveProfile();

  if (!wallet) {
    showToast('Kết nối ví trước khi eKYC.');
    return false;
  }

  if (!profile) {
    setPage('profiles');
    const walletField = $('#profileWallet');
    if (walletField) walletField.value = wallet;
    showToast('Tạo hồ sơ cá nhân trước khi eKYC.');
    return false;
  }

  const backdrop = $('#mockEkycBackdrop');
  const modal = $('#mockEkycModal');
  const form = $('#mockEkycForm');
  const hint = $('#mockEkycHint');
  const status = $('#mockEkycStatus');

  state.pendingBuyPropertyId = resumeBuy ? propertyId : '';
  if (form) form.reset();
  if (hint) {
    hint.textContent = resumeBuy
      ? 'Hoàn tất eKYC mock để tiếp tục lệnh mua NFT này.'
      : 'Upload ảnh CCCD và chân dung để kích hoạt quyền giao dịch cho ví hiện tại.';
  }
  if (status) {
    const record = getMockEkycRecord(wallet);
    if (profile?.verified) {
      status.textContent = record?.completedAt
        ? `Trạng thái hiện tại: đã xác thực eKYC mock lúc ${formatDateTime(record.completedAt)}.`
        : 'Trạng thái hiện tại: đã xác thực eKYC trên server.';
    } else {
      status.textContent = record?.completedAt
        ? `Trạng thái hiện tại: đã xác thực mock lúc ${formatDateTime(record.completedAt)}.`
        : 'Trạng thái hiện tại: chưa xác thực eKYC mock.';
    }
  }

  if (backdrop) backdrop.hidden = false;
  if (modal) modal.hidden = false;
  return true;
}

async function completeMockEkyc(event) {
  event.preventDefault();

  const wallet = getActiveWallet();
  const profile = getActiveProfile();
  const form = $('#mockEkycForm');

  if (!wallet || !profile || !form) {
    showToast('Cần kết nối ví và tạo hồ sơ cá nhân trước khi eKYC.');
    return;
  }

  const data = new FormData(form);
  const idFront = data.get('id_front');
  const idBack = data.get('id_back');
  const portrait = data.get('portrait');

  if (!idFront?.name || !idBack?.name || !portrait?.name) {
    showToast('Vui lòng chọn đủ 2 mặt CCCD và ảnh chân dung.');
    return;
  }

  // Optimistically store local mock record for immediate UI feedback
  setMockEkycRecord(wallet, {
    status: 'approved',
    profileId: profile.id,
    completedAt: new Date().toISOString(),
    files: {
      idFront: idFront.name,
      idBack: idBack.name,
      portrait: portrait.name
    }
  });

  const pendingPropertyId = state.pendingBuyPropertyId;
  closeMockEkycModal({ clearPending: false });
  state.pendingBuyPropertyId = '';
  renderHomeDashboard();
  renderDataList();
  const record = getMockEkycRecord(wallet);
  const completeAt = record?.completedAt ? formatDateTime(record.completedAt) : formatDateTime(new Date().toISOString());
  showToast(`Đã hoàn tất eKYC cho ${profile.full_name || shortAddress(wallet)} lúc ${completeAt}. Đã lưu trạng thái verified trên server; người khác cũng sẽ thấy hồ sơ này đã được eKYC.`);

  try {
    await api(`/api/profiles/${profile.id}/ekyc`, { method: 'POST' });
    await loadData();
    showToast('Trạng thái eKYC đã đồng bộ với server. Mọi người đều có thể thấy hồ sơ đã xác thực.');
  } catch (error) {
    showToast('Lưu eKYC lên server thất bại. Vui lòng thử lại.');
    console.error('eKYC save error', error);
  }

  if (pendingPropertyId) {
    run(() => buyListedNft(pendingPropertyId, { skipMockEkyc: true }));
  }
}

function setFieldValue(selector, value) {
  const field = $(selector);
  if (field) field.value = value ?? '';
}

function fillTransferFormsFromRecord(item) {
  if (!item) return;

  setFieldValue('#transferForm [name="backend_transaction_id"]', item.backend_transaction_id || '');
  setFieldValue('#transferForm [name="backend_transaction_hash"]', item.backend_transaction_hash || '');
  setFieldValue('#transferForm [name="property_id"]', item.property_id || item.id || '');
  setFieldValue('#transferForm [name="sc_property_id"]', item.sc_property_id || '');
  setFieldValue('#transferForm [name="certificate_token_id"]', item.certificate_token_id || '');
  setFieldValue('#transferForm [name="buyer_profile_id"]', item.buyer_profile_id || '');
  setFieldValue('#transferForm [name="buyer_wallet_address"]', item.buyer_wallet_address || '');
  setFieldValue('#transferForm [name="price_eth"]', weiToEth(item.price_wei || item.asking_price_wei || '0'));
  setFieldValue('#transferForm [name="document_hash"]', item.document_hash || item.legal_document_hash || '');
  setFieldValue('#transferForm [name="listing_sale_id"]', item.sc_sale_id || item.listing_sale_id || '');
  setFieldValue('#releaseForm [name="transfer_db_id"]', item.id || '');
  setFieldValue('#releaseForm [name="sale_id"]', item.sc_sale_id || item.listing_sale_id || '');
  setFieldValue('#releaseForm [name="tx_hash"]', item.deposit_tx_hash || item.release_tx_hash || item.cancel_tx_hash || item.listing_tx_hash || '');
}

function prepareBuyNft(propertyId) {
  const item = findNftItemByPropertyId(propertyId);

  if (!item) {
    throw new Error('Không tìm thấy NFT/tài sản đã chọn. Hãy bấm Tải NFT trước.');
  }

  if (isPropertyBlocked(item)) {
    throw new Error('NFT này đang bị khóa trên nền tảng và không thể giao dịch.');
  }

  const buyerWallet = getActiveWallet();

  if (!buyerWallet) {
    throw new Error('Buyer cần đăng nhập/kết nối ví trước khi chọn mua NFT.');
  }

  if (sameWallet(buyerWallet, item.owner_wallet_address)) {
    throw new Error('Ví hiện tại đang là chủ NFT này, không thể tự mua chính NFT của mình.');
  }

  if (!item.sc_property_id || !item.certificate_token_id) {
    throw new Error('NFT này chưa được mint hoặc chưa cập nhật mã NFT. Seller cần mint NFT trước khi buyer chọn mua.');
  }

  const priceWei = item.asking_price_wei || '0';

  if (BigInt(priceWei || 0) <= 0n) {
    throw new Error('Seller chưa niêm yết giá bán cho NFT này. Hãy cập nhật giá bán ETH rồi thử lại.');
  }

  const buyerProfile = state.profiles.find((profile) => sameWallet(profile.wallet_address, buyerWallet));

  if (!buyerProfile) {
    throw new Error('Buyer cần tạo hồ sơ cá nhân bằng ví hiện tại trước khi mua NFT.');
  }

  const txId = `BUY-${item.property_id || item.id}-${Date.now()}`;

  $('#transferForm [name="property_id"]').value = item.property_id || item.id || '';
  $('#transferForm [name="sc_property_id"]').value = item.sc_property_id || '';
  $('#transferForm [name="certificate_token_id"]').value = item.certificate_token_id || '';
  $('#transferForm [name="buyer_profile_id"]').value = buyerProfile.id;
  $('#transferForm [name="buyer_wallet_address"]').value = buyerWallet;
  $('#transferForm [name="price_eth"]').value = weiToEth(priceWei);
  $('#transferForm [name="backend_transaction_id"]').value = txId;
  $('#transferForm [name="backend_transaction_hash"]').value = `${txId}-HASH`;
  $('#transferForm [name="document_hash"]').value = `${txId}-DOC`;
  $('#releaseForm [name="transfer_db_id"]').value = '';
  $('#releaseForm [name="sale_id"]').value = '';
  $('#releaseForm [name="tx_hash"]').value = '';

  setPage('transfers');
  showToast('Đã chọn NFT, kiểm tra thông tin rồi bấm Tạo hồ sơ giao dịch');
}

function prepareListNft(propertyId) {
  const item = findNftItemByPropertyId(propertyId);

  if (!item) {
    throw new Error('Không tìm thấy tài sản cần list. Hãy bấm Làm mới trước.');
  }

  if (isPropertyBlocked(item)) {
    throw new Error('NFT này đang bị khóa trên nền tảng và không thể niêm yết.');
  }

  const wallet = getActiveWallet();

  if (!wallet) {
    throw new Error('Seller cần kết nối ví trước khi list NFT.');
  }

  if (!sameWallet(wallet, item.owner_wallet_address)) {
    throw new Error('Chỉ owner hiện tại mới được list NFT này.');
  }

  if (!item.sc_property_id || !item.certificate_token_id) {
    throw new Error('Tài sản này chưa mint NFT nên chưa thể list.');
  }

  const listingId = `LIST-${item.property_id || item.id}-${Date.now()}`;
  fillTransferFormsFromRecord({
    ...item,
    backend_transaction_id: listingId,
    backend_transaction_hash: `${listingId}-HASH`,
    document_hash: item.legal_document_hash || `${listingId}-DOC`,
    price_wei: item.asking_price_wei || '0'
  });

  setPage('transfers');
  showToast('Đã chọn NFT để niêm yết. NFT chỉ được chuyển khi giao dịch mua hoàn tất.');
}

async function listNftForSale() {
  const body = collectForm('#transferForm');
  const propertyId = body.property_id;

  if (!propertyId) {
    throw new Error('Hãy chọn hoặc nhập ID hồ sơ tài sản cần list.');
  }

  const item = findNftItemByPropertyId(propertyId);

  if (!item) {
    throw new Error('Không tìm thấy tài sản trong dữ liệu hiện tại. Hãy bấm Làm mới.');
  }

  if (isPropertyBlocked(item)) {
    throw new Error('NFT này đang bị khóa trên nền tảng và không thể niêm yết.');
  }

  const sellerWallet = await getConnectedWallet();

  if (!sameWallet(sellerWallet, item.owner_wallet_address)) {
    throw new Error('Chỉ owner hiện tại mới được list NFT này.');
  }

  const priceWei = ethToWei(body.price_eth, 'Giá seller muốn nhận');

  if (BigInt(priceWei) <= 0n) {
    throw new Error('Giá list phải lớn hơn 0 ETH.');
  }

  const backendTransactionId = body.backend_transaction_id || `LIST-${propertyId}-${Date.now()}`;
  const documentHash = body.document_hash || item.legal_document_hash || `${backendTransactionId}-DOC`;
  const nft = await getNftContract();
  const tokenId = body.certificate_token_id || item.certificate_token_id;
  const escrowAddress = getContractAddress('escrow');
  const chainOwner = await nft.ownerOf(tokenId);

  if (!sameWallet(chainOwner, sellerWallet)) {
    throw new Error(`NFT token #${tokenId} tren blockchain dang thuoc vi ${shortAddress(chainOwner)}, khong phai vi hien tai ${shortAddress(sellerWallet)}. Hay chon dung tai san/tokenId hoac dong bo lai owner trong database.`);
  }

  const approvedAddress = await nft.getApproved(tokenId).catch(() => '');
  const approvedForAll = await nft.isApprovedForAll(sellerWallet, escrowAddress).catch(() => false);

  if (!sameWallet(approvedAddress, escrowAddress) && !approvedForAll) {
    const approveTx = await nft.approve(escrowAddress, tokenId);
    logAction('Đã gửi approve NFT', approveTx.hash);
    await approveTx.wait();
  }

  const escrow = await getEscrowContract();
  const tx = await escrow.listCertificate(
    body.sc_property_id || item.sc_property_id,
    priceWei,
    toBytes32(backendTransactionId),
    toBytes32(documentHash)
  );

  logAction('Đã gửi list NFT', tx.hash);
  const receipt = await tx.wait();
  const saleId = await escrow.saleIdByBackendTransactionId(toBytes32(backendTransactionId));
  const feeWei = await escrow.getTransactionFee(priceWei);

  setFieldValue('#transferForm [name="backend_transaction_id"]', backendTransactionId);
  setFieldValue('#transferForm [name="document_hash"]', documentHash);
  setFieldValue('#transferForm [name="listing_sale_id"]', saleId.toString());

  await api(`/api/properties/${propertyId}/listing`, {
    method: 'PATCH',
    body: JSON.stringify({
      listing_status: 'listed',
      listing_sale_id: saleId.toString(),
      listing_tx_hash: receipt.hash || tx.hash,
      asking_price_wei: priceWei
    })
  });

  logAction('NFT đã được list', `saleId ${saleId.toString()} - fee buyer ${feeWei.toString()} wei`);
  showToast(`Đã list NFT. Buyer sẽ trả ${formatEthVndPrice(calculateTotalPriceWei(priceWei))}, trong đó có phí admin 1%.`);
  await loadData();
  await loadLedgerData();
}

async function cancelListing() {
  const body = collectForm('#transferForm');
  const propertyId = body.property_id;
  const item = findNftItemByPropertyId(propertyId);
  const saleId = body.listing_sale_id || item?.listing_sale_id;

  if (!propertyId || !saleId) {
    throw new Error('Hãy chọn NFT đang listed và có saleId trước khi hủy niêm yết.');
  }

  const wallet = await getConnectedWallet();

  if (!sameWallet(wallet, item?.owner_wallet_address)) {
    throw new Error('Chỉ seller owner hiện tại mới được hủy listing.');
  }

  const escrow = await getEscrowContract();
  const tx = await escrow.cancelCertificateSale(saleId);
  logAction('Đã gửi hủy listing', tx.hash);
  const receipt = await tx.wait();

  await api(`/api/properties/${propertyId}/listing`, {
    method: 'PATCH',
    body: JSON.stringify({
      listing_status: 'cancelled',
      listing_tx_hash: receipt.hash || tx.hash
    })
  });

  showToast('Đã hủy niêm yết.');
  await loadData();
  await loadLedgerData();
}

async function buyListedNft(propertyId, options = {}) {
  const item = findNftItemByPropertyId(propertyId);

  if (!item) {
    throw new Error('Không tìm thấy NFT trên marketplace. Hãy bấm Tải NFT/Làm mới.');
  }

  if (isPropertyBlocked(item)) {
    throw new Error('NFT này đang bị khóa trên nền tảng và không thể giao dịch.');
  }

  if (item.listing_status !== 'listed' || !item.listing_sale_id) {
    throw new Error('NFT này chưa được list để bán.');
  }

  const buyerWallet = await getConnectedWallet();

  if (!buyerWallet) {
    throw new Error('Buyer cần đăng nhập và kết nối ví trước khi mua NFT.');
  }

  if (sameWallet(buyerWallet, item.owner_wallet_address)) {
    throw new Error('Ví hiện tại đang là owner NFT này, không thể tự mua chính mình.');
  }

  const buyerProfile = state.profiles.find((profile) => sameWallet(profile.wallet_address, buyerWallet));

  if (!buyerProfile) {
    throw new Error('Buyer cần tạo hồ sơ cá nhân bằng ví hiện tại trước khi mua NFT.');
  }

  if (!options.skipMockEkyc && !hasMockEkyc(buyerWallet)) {
    openMockEkycModal({ propertyId, resumeBuy: true });
    return;
  }

  const priceWei = item.asking_price_wei || '0';

  if (BigInt(priceWei) <= 0n) {
    throw new Error('Listing này chưa có giá hợp lệ.');
  }

  const escrow = await getEscrowContract();
  const feeWei = (await escrow.getTransactionFee(priceWei)).toString();
  const totalWei = (BigInt(priceWei) + BigInt(feeWei)).toString();
  const tx = await escrow.buyCertificate(item.listing_sale_id, { value: totalWei });

  logAction('Buyer đã gửi mua NFT', `${tx.hash} - total ${totalWei} wei`);
  const receipt = await tx.wait();
  const backendTransactionId = `BUY-${propertyId}-${Date.now()}`;

  await api('/api/transfers/purchase', {
    method: 'POST',
    body: JSON.stringify({
      property_id: propertyId,
      buyer_profile_id: buyerProfile.id,
      sc_sale_id: item.listing_sale_id,
      price_wei: priceWei,
      fee_wei: feeWei,
      buy_tx_hash: receipt.hash || tx.hash,
      backend_transaction_id: backendTransactionId,
      backend_transaction_hash: receipt.hash || tx.hash,
      document_hash: `BUY-DOC-${propertyId}`
    })
  });

  showToast(`Mua thành công. Seller nhận ${formatEthVndPrice(priceWei)}, admin nhận phí ${formatEthVndPrice(feeWei)}.`);
  await loadData();
  await loadLedgerData();
}

function includesText(source, query) {
  return String(source || '').toLowerCase().includes(query);
}

function buildSearchResults(query) {
  const normalized = String(query || '').trim().toLowerCase();

  if (!normalized) {
    return { nfts: [], users: [] };
  }

  const nfts = state.ledgerOwnership.filter((item) => [
    item.location,
    item.backend_property_id,
    item.certificate_uri,
    item.certificate_token_id,
    item.sc_property_id,
    item.owner_full_name,
    item.owner_wallet_address
  ].some((value) => includesText(value, normalized))).slice(0, 6);

  const users = state.profiles.filter((item) => [
    item.full_name,
    item.wallet_address,
    item.backend_person_id,
    item.email,
    item.phone
  ].some((value) => includesText(value, normalized))).slice(0, 6);

  return { nfts, users };
}

function renderSearchResults() {
  const input = $('#globalSearchInput');
  const box = $('#searchResults');
  if (!input || !box) return;

  const { nfts, users } = buildSearchResults(input.value);

  if (!input.value.trim()) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const nftHtml = nfts.length ? `
    <div class="search-group-title">NFT Certificates</div>
    ${nfts.map((item) => `
      <button class="search-result-item" type="button" data-search-wallet="${escapeHtml(item.owner_wallet_address || '')}">
        <span class="search-thumb">${item.first_image_gateway_url ? `<img src="${escapeHtml(item.first_image_gateway_url)}" alt="" />` : `#${escapeHtml(item.certificate_token_id ?? '--')}`}</span>
        <span>
          <strong>${escapeHtml(item.location || 'Property certificate')}</strong>
          <small>tokenId #${escapeHtml(item.certificate_token_id ?? '--')} · owner ${escapeHtml(item.owner_full_name || shortAddress(item.owner_wallet_address))}</small>
        </span>
      </button>
    `).join('')}
  ` : '';

  const userHtml = users.length ? `
    <div class="search-group-title">Users</div>
    ${users.map((item) => `
      <button class="search-result-item" type="button" data-search-wallet="${escapeHtml(item.wallet_address || '')}">
        <span class="search-thumb">${escapeHtml(walletInitials(item.wallet_address))}</span>
        <span>
          <strong>${escapeHtml(item.full_name || 'Unnamed user')}</strong>
          <small>${escapeHtml(shortAddress(item.wallet_address))} · ${escapeHtml(item.backend_person_id || '')}</small>
        </span>
      </button>
    `).join('')}
  ` : '';

  box.hidden = false;
  box.innerHTML = nftHtml || userHtml ? `${nftHtml}${userHtml}` : `
    <div class="search-result-item">
      <span class="search-thumb">--</span>
      <span>
        <strong>Không tìm thấy</strong>
        <small>Thử nhập tên người dùng, ví, tokenId hoặc địa chỉ tài sản.</small>
      </span>
    </div>
  `;
}

function syncApiInputs() {
  const authInput = $('#authApiBaseInput');
  const systemInput = $('#apiBaseInput');

  if (authInput) authInput.value = state.apiBase;
  if (systemInput) systemInput.value = state.apiBase;
}

function setApiBase(value) {
  state.apiBase = String(value || '').replace(/\/$/, '');
  localStorage.setItem('propertyChainApiBase', state.apiBase);
  syncApiInputs();
  logAction('Đã đổi địa chỉ dịch vụ API', state.apiBase);
}

function renderSession() {
  const user = state.currentUser;
  const loggedIn = Boolean(user && state.token);

  $('#authScreen').hidden = loggedIn;
  $('#appShell').hidden = !loggedIn;

  if ($('#sessionUser')) {
    $('#sessionUser').textContent = loggedIn ? user.displayName || user.username : 'Chưa đăng nhập';
  }

  if ($('#sessionRole')) {
    $('#sessionRole').textContent = loggedIn ? formatRole(user.role) : 'Khách';
  }

  if (loggedIn) {
    setMode(user.role === 'admin' ? 'admin' : 'user');
  } else {
    setMode('user');
  }

  renderProfilePage();
  renderRiskAdmin();
}

async function loadSetupStatus() {
  const setupBox = $('#setupBox');

  if (!setupBox) return;

  try {
    const payload = await api('/api/auth/setup-status');
    state.setupAllowed = Boolean(payload.data?.setupAllowed);
    setupBox.hidden = !state.setupAllowed;
  } catch (error) {
    state.setupAllowed = false;
    setupBox.hidden = true;
  }
}

async function requestWalletLoginSignature() {
  if (!window.ethereum) {
    throw new Error('Chrome chưa có MetaMask hoặc trang chưa được MetaMask cho phép kết nối');
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainId = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => state.chainId);
  updateWalletUi(accounts[0] || '', chainId);

  const signer = await getSigner();
  const address = await signer.getAddress();
  const provider = signer.provider;
  const network = await provider.getNetwork().catch(() => null);

  state.account = address;
  state.chainId = network ? `0x${Number(network.chainId).toString(16)}` : chainId;
  updateWalletUi(address, state.chainId);

  const challenge = await api('/api/auth/wallet/nonce', {
    method: 'POST',
    body: JSON.stringify({ wallet_address: address })
  });

  const signature = await signer.signMessage(challenge.data.message);
  return { address, signature };
}

async function login() {
  const { address, signature } = await requestWalletLoginSignature();
  const payload = await api('/api/auth/wallet/login', {
    method: 'POST',
    body: JSON.stringify({
      wallet_address: address,
      signature
    })
  });

  state.token = payload.data.token;
  state.currentUser = payload.data.user;
  localStorage.setItem('propertyChainToken', state.token);
  renderSession();
  updateWalletUi(address, state.chainId);
  closeProfileDrawer();
  setPage('home');
  logAction('Đăng nhập ví thành công', `${shortAddress(address)} (${formatRole(state.currentUser.role)})`);
  showToast('Đăng nhập ví thành công');
  await refreshAll();
}

async function setupAdmin() {
  const body = collectForm('#setupForm');
  const { address, signature } = await requestWalletLoginSignature();
  const payload = await api('/api/auth/setup-wallet', {
    method: 'POST',
    body: JSON.stringify({
      wallet_address: address,
      signature,
      display_name: body.display_name
    })
  });

  state.token = payload.data.token;
  state.currentUser = payload.data.user;
  localStorage.setItem('propertyChainToken', state.token);
  renderSession();
  logAction('Đã khởi tạo tài khoản quản trị bằng ví', shortAddress(address));
  showToast('Tài khoản quản trị đầu tiên đã được tạo');
  await refreshAll();
}

function showWalletConnectInfo() {
  showToast('WalletConnect cần Project ID riêng. Phiên hiện tại dùng MetaMask/injected wallet.');
}

function logout() {
  state.token = '';
  state.currentUser = null;
  state.users = [];
  localStorage.removeItem('propertyChainToken');
  renderSession();
  renderRiskAdmin();
  showToast('Đã đăng xuất');
}

async function restoreSession() {
  syncApiInputs();

  await loadSetupStatus();

  if (!state.token) {
    renderSession();
    return;
  }

  try {
    const payload = await api('/api/auth/me');
    state.currentUser = payload.data;
    renderSession();
    await connectWalletSilently();
    await refreshAll();
  } catch (error) {
    state.token = '';
    state.currentUser = null;
    localStorage.removeItem('propertyChainToken');
    renderSession();
    logAction('Phiên đăng nhập hết hạn', error.message);
  }
}

function renderContracts() {
  const addresses = state.contracts?.addresses || {};
  $('#nftAddress').textContent = addresses.nft || '--';
  $('#registryAddress').textContent = addresses.registry || '--';
  $('#escrowAddress').textContent = addresses.escrow || '--';
  if ($('#feeRecipientStatus')) {
    $('#feeRecipientStatus').textContent = shortAddress(state.contracts?.feeRecipient);
    $('#feeRecipientStatus').title = state.contracts?.feeRecipient || '';
  }

  const hasAll = Boolean(addresses.nft && addresses.registry && addresses.escrow);
  $('#chainStatus').textContent = hasAll ? `Chain ${state.contracts.chainId || '--'}` : 'Thiếu address';
  setDot('#chainDot', hasAll ? 'ok' : 'warn');
}

function renderHomeHero() {
  const hero = $('.hero-panel[data-page="home"]');
  if (!hero) return;

  const title = hero.querySelector('.hero-copy h1');
  const subtitle = hero.querySelector('.hero-subtitle');

  if (title) title.textContent = 'Real Estate Hub';
  if (subtitle) {
    subtitle.textContent = 'Nền tảng token hóa bất động sản thành NFT: mint tài sản vào ví owner, list khi seller muốn bán, buyer mua qua escrow với phí marketplace 1%.';
  }

  const marketTitle = $('#homeNftMarket h2');
  const marketEyebrow = $('#homeNftMarket .eyebrow');
  if (marketTitle) marketTitle.textContent = 'Marketplace nổi bật';
  if (marketEyebrow) marketEyebrow.textContent = 'Marketplace preview';

  let note = hero.querySelector('.hero-flow-note');
  if (!note) {
    note = document.createElement('p');
    note.className = 'hero-flow-note';
    hero.querySelector('.hero-copy')?.append(note);
  }
  note.textContent = 'Mint xong NFT vẫn thuộc ví owner. Chỉ khi seller bấm List, tài sản mới xuất hiện như một listing đang bán trên Marketplace.';
}

function quickActionButton({ label, title, detail, action = '', page = '' }) {
  const attr = action ? `data-dashboard-action="${escapeHtml(action)}"` : `data-nav-page="${escapeHtml(page)}"`;

  return `
    <button class="home-action" type="button" ${attr}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </button>
  `;
}

function renderHomeQuickActions() {
  const grid = $('#homeQuickActions');
  if (!grid) return;

  if (state.currentUser?.role === 'admin') {
    const totalFeesWei = state.ledgerTransfers.reduce((sum, item) => {
      try {
        return sum + BigInt(item.fee_wei || 0);
      } catch (error) {
        return sum;
      }
    }, 0n);
    const blockedUsers = state.users.filter((user) => !user.active).length;
    const blockedNfts = state.properties.filter((item) => isPropertyBlocked(item)).length;

    grid.innerHTML = [
      quickActionButton({
        label: 'Fees',
        title: formatWei(totalFeesWei.toString()),
        detail: 'Tổng phí marketplace ví admin đã nhận.',
        page: 'profile',
      }),
      quickActionButton({
        label: 'Users',
        title: `${blockedUsers} user bị khóa`,
        detail: 'Xem và mở lại quyền sử dụng nền tảng.',
        action: 'open-admin-risk',
      }),
      quickActionButton({
        label: 'NFT Risk',
        title: `${blockedNfts} NFT bị khóa`,
        detail: 'Quản trị NFT nghi ngờ rủi ro hoặc lừa đảo.',
        action: 'open-admin-risk',
      }),
      quickActionButton({
        label: 'Ledger',
        title: `${state.ledgerTransfers.length} giao dịch`,
        detail: 'Theo dõi giao dịch mua bán gần đây.',
        page: 'ledger',
      }),
    ].join('');
    return;
  }

  grid.innerHTML = [
    quickActionButton({
      label: 'eKYC',
      title: 'Tạo hồ sơ / eKYC',
      detail: 'Liên kết ví với hồ sơ đã xác thực trước khi giao dịch.',
      action: 'open-ekyc',
    }),
    quickActionButton({
      label: 'Mint',
      title: 'Mint NFT tài sản',
      detail: 'Tạo NFT bất động sản vào ví chủ sở hữu.',
      page: 'properties',
    }),
    quickActionButton({
      label: 'List',
      title: 'List NFT để bán',
      detail: 'Approve và niêm yết NFT khi seller muốn mở bán.',
      page: 'transfers',
    }),
    quickActionButton({
      label: 'Assets',
      title: 'Xem tài sản của tôi',
      detail: 'Theo dõi NFT, token và lịch sử của ví hiện tại.',
      page: 'profile',
    }),
  ].join('');
}

function renderHomeGuide() {
  const overview = $('#overview .overview-grid');
  if (!overview) return;

  overview.innerHTML = `
    <article>
      <strong>1. eKYC</strong>
      <small>Tạo hồ sơ ví và xác thực danh tính mô phỏng trước khi mua bán tài sản.</small>
    </article>
    <article>
      <strong>2. Mint</strong>
      <small>Seller mint NFT bất động sản vào ví owner. NFT chưa tự động lên sàn.</small>
    </article>
    <article>
      <strong>3. List</strong>
      <small>Owner approve escrow và niêm yết NFT khi muốn bán.</small>
    </article>
    <article>
      <strong>4. Buy</strong>
      <small>Buyer thanh toán qua escrow; NFT chuyển sang buyer và phí 1% về ví admin.</small>
    </article>
  `;
}

function checklistItem({ stateName, title, detail, action, actionLabel }) {
  const badgeLabel = stateName === 'ok' ? 'Đã sẵn sàng' : stateName === 'warn' ? 'Cần xử lý' : 'Đang chặn';

  return `
    <article class="home-check-item ${stateName}">
      <span class="check-dot ${stateName}" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
      ${action ? `<button class="text-button" type="button" data-dashboard-action="${escapeHtml(action)}">${escapeHtml(actionLabel || badgeLabel)}</button>` : `<span class="check-badge">${escapeHtml(badgeLabel)}</span>`}
    </article>
  `;
}

function renderHomeChecklist() {
  const list = $('#homeWalletChecklist');
  if (!list) return;

  const wallet = getActiveWallet();
  const profile = getActiveProfile();
  const walletReady = Boolean(wallet);
  const networkReady = isExpectedNetwork();
  const ekycReady = isWalletEkycReady();
  const mockEkycRecord = getMockEkycRecord(wallet);
  const ekycTitle = ekycReady ? 'eKYC mock đã hoàn tất' : 'Hoàn tất eKYC';
  const ekycDetail = ekycReady
    ? `${profile?.full_name || 'Hồ sơ ví'} đã upload CCCD và ảnh chân dung mock lúc ${formatDateTime(mockEkycRecord?.completedAt)}.`
    : 'Tạo hồ sơ cá nhân, sau đó upload 2 mặt CCCD và ảnh chân dung để mua NFT.';

  list.innerHTML = [
    checklistItem({
      stateName: walletReady ? 'ok' : 'warn',
      title: walletReady ? `Ví ${shortAddress(wallet)}` : 'Kết nối ví',
      detail: walletReady ? 'MetaMask đã liên kết với phiên hiện tại.' : 'Kết nối MetaMask trước khi mint, list hoặc mua NFT.',
      action: walletReady ? '' : 'connect-wallet',
      actionLabel: 'Kết nối',
    }),
    checklistItem({
      stateName: networkReady ? 'ok' : 'warn',
      title: networkReady ? `Network ${expectedChainIdDecimal()}` : 'Chuyển network',
      detail: state.chainId
        ? `Chain hiện tại ${currentChainIdDecimal() || '--'}; yêu cầu ${expectedChainIdDecimal()}.`
        : `Yêu cầu Sepolia chain ${expectedChainIdDecimal()}.`,
      action: networkReady ? '' : 'connect-wallet',
      actionLabel: 'Kiểm tra ví',
    }),
    checklistItem({
      stateName: ekycReady ? 'ok' : 'warn',
      title: ekycReady ? 'eKYC đã xác thực' : 'Tạo hồ sơ eKYC',
      detail: ekycReady
        ? `${profile?.full_name || 'Hồ sơ ví'} đã được xác thực trong hệ thống.`
        : 'Tạo hoặc hoàn tất hồ sơ ví trước khi mua NFT bất động sản.',
      action: ekycReady ? '' : 'open-ekyc',
      title: ekycTitle,
      detail: ekycDetail,
      actionLabel: 'Bắt đầu',
    }),
  ].join('');
}

function renderHomeSnapshot() {
  const wallet = getActiveWallet();
  const { ownedNfts, history, totalWei, totalFeesWei } = getProfileData(wallet);
  const adminProfile = isAdminProfileWallet(wallet);
  const listedOwned = ownedNfts.filter((item) => item.listing_status === 'listed');

  if ($('#homeOwnedNftCount')) $('#homeOwnedNftCount').textContent = ownedNfts.length;
  if ($('#homeListedNftCount')) $('#homeListedNftCount').textContent = listedOwned.length;
  if ($('#homeWalletHistoryCount')) $('#homeWalletHistoryCount').textContent = history.length;
  if ($('#homeValueLabel')) $('#homeValueLabel').textContent = adminProfile ? 'Phí nhận' : 'Giá trị';
  if ($('#homeWalletValue')) $('#homeWalletValue').textContent = formatWei((adminProfile ? totalFeesWei : totalWei).toString());
}

function renderHomeActivity() {
  const list = $('#homeActivityList');
  if (!list) return;

  const transfers = state.ledgerTransfers.slice(0, 4).map((item) => ({
    title: `${formatStatus(item.status)} - ${item.location || 'Property NFT'}`,
    detail: `${shortAddress(item.seller_wallet_address)} -> ${shortAddress(item.buyer_wallet_address)} | ${formatEthVndPrice(item.price_wei || '0')}`,
    time: item.updated_at || item.released_at || item.created_at,
  }));
  const minted = state.ledgerOwnership
    .filter((item) => item.sc_property_id && item.certificate_token_id)
    .slice(0, Math.max(0, 4 - transfers.length))
    .map((item) => ({
      title: `Token #${item.certificate_token_id} - ${item.location || 'Property NFT'}`,
      detail: `${formatListingStatus(item.listing_status)} | owner ${shortAddress(item.owner_wallet_address)}`,
      time: item.updated_at || item.last_changed_at,
    }));
  const riskItems = state.currentUser?.role === 'admin'
    ? [
      ...state.users
        .filter((user) => !user.active)
        .map((user) => ({
          title: `User bị khóa - ${user.displayName || user.username || user.id}`,
          detail: riskReason(user) || 'Tài khoản đang bị vô hiệu hóa trên nền tảng.',
          time: user.suspendedAt || user.suspended_at || user.updated_at,
        })),
      ...state.properties
        .filter((item) => isPropertyBlocked(item))
        .map((item) => ({
          title: `NFT bị khóa - ${item.location || `Property #${item.id}`}`,
          detail: riskReason(item) || 'NFT đang bị vô hiệu hóa trên marketplace.',
          time: item.risk_flagged_at || item.updated_at,
        })),
    ]
    : [];
  const items = [...riskItems, ...transfers, ...minted].slice(0, 4);

  if (!items.length) {
    list.innerHTML = `
      <div class="home-empty-state">
        <strong>Chưa có hoạt động</strong>
        <small>Mint, list hoặc mua NFT để cập nhật sổ giao dịch.</small>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map((item) => `
    <article class="home-activity-item">
      <span></span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
        <small>${escapeHtml(formatDateTime(item.time))}</small>
      </div>
    </article>
  `).join('');
}

function renderHomeDashboard() {
  renderHomeHero();
  renderHomeQuickActions();
  renderHomeChecklist();
  renderHomeSnapshot();
  renderHomeActivity();
  renderHomeGuide();
}

function renderMetrics() {
  $('#profileCount').textContent = state.profiles.length;
  $('#propertyCount').textContent = state.properties.length;
  $('#transferCount').textContent = state.transfers.length;
  $('#accountShort').textContent = shortAddress(state.account);
  $('#networkLabel').textContent = state.chainId ? `Chain ${Number(state.chainId)}` : 'Chưa có network';
  renderHomeDashboard();
}

function getPageFromHash() {
  const raw = (window.location.hash || '#/home').replace(/^#\/?/, '');
  return allowedPages.includes(raw) ? raw : 'home';
}

function setPage(page) {
  const nextPage = state.mode === 'user' && page === 'system' ? 'home' : page;
  state.page = nextPage;
  document.body.dataset.page = nextPage;

  $$('.route-page').forEach((section) => {
    section.hidden = section.dataset.page !== nextPage;
  });

  $$('[data-nav-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.navPage === nextPage);
  });

  if (window.location.hash !== `#/${nextPage}`) {
    window.history.replaceState(null, '', `#/${nextPage}`);
  }
}

function setMode(mode) {
  state.mode = mode === 'admin' ? 'admin' : 'user';

  document.body.classList.toggle('user-mode', state.mode === 'user');
  document.body.classList.toggle('admin-mode', state.mode === 'admin');

  $$('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });

  if (state.mode === 'user' && state.page === 'system') {
    setPage('home');
  } else {
    setPage(state.page || getPageFromHash());
  }

}

function formatDateTime(value) {
  if (!value) return '--';

  try {
    return new Date(value).toLocaleString('vi-VN');
  } catch (error) {
    return String(value);
  }
}

function formatStatus(value) {
  const labels = {
    created: 'Đã tạo',
    deposited: 'Đã ký gửi',
    released: 'Đã chuyển nhượng',
    cancelled: 'Đã hủy'
  };

  return labels[value] || value || '--';
}

function txLink(hash) {
  if (!hash) return '--';
  return `<a href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noreferrer">${shortAddress(hash)}</a>`;
}

function renderDataList() {
  const list = $('#dataList');
  const items = state[state.activeTable] || [];

  if (!items.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có dữ liệu</strong><small>Bấm Làm mới hoặc tạo dữ liệu mới.</small></div>';
    return;
  }

  list.innerHTML = items.slice(0, 8).map((item) => {
    if (state.activeTable === 'profiles') {
      return `
        <article class="data-item">
          <strong>#${item.id} - ${item.full_name || 'No name'}</strong>
          <small>${shortAddress(item.wallet_address)} | eKYC: ${hasMockEkyc(item.wallet_address) ? 'Đã hoàn tất' : 'Chưa hoàn tất'}</small>
          <small>${item.email || '--'} · ${item.phone || '--'} · ${item.address || '--'}</small>
          <small>${item.backend_person_id}</small>
        </article>
      `;
    }

    if (state.activeTable === 'properties') {
      const isOwner = sameWallet(getActiveWallet(), item.owner_wallet_address);
      const isMinted = item.sc_property_id !== null && item.sc_property_id !== undefined
        && item.certificate_token_id !== null && item.certificate_token_id !== undefined;
      const priceWei = item.asking_price_wei || '0';
      const feeWei = calculateFeeWei(priceWei);
      const totalWei = calculateTotalPriceWei(priceWei);
      return `
        <article class="data-item">
          <strong>#${item.id} - ${item.location || 'No location'}</strong>
          <small>owner: ${item.owner_full_name || shortAddress(item.owner_wallet_address)}</small>
          <small>SC propertyId: ${item.sc_property_id ?? '--'} | tokenId: ${item.certificate_token_id ?? '--'}</small>
          <small>Trạng thái list: ${escapeHtml(formatListingStatus(item.listing_status))} | saleId: ${item.listing_sale_id ?? '--'}</small>
          <small>Phí admin 1%: ${formatEthPrice(feeWei)} | Buyer trả: ${formatEthPrice(totalWei)}</small>
          <small>Trạng thái nền tảng: ${escapeHtml(riskStatusLabel(item))}${riskReason(item) ? ` · ${escapeHtml(riskReason(item))}` : ''}</small>
          ${isOwner && !isPropertyBlocked(item) && isMinted && item.listing_status !== 'listed' ? `<button class="text-button" type="button" data-list-property="${escapeHtml(item.id)}">List NFT</button>` : ''}
          ${isOwner && !isPropertyBlocked(item) && item.listing_status === 'listed' ? `<button class="text-button" type="button" data-cancel-listing-property="${escapeHtml(item.id)}">Hủy listing</button>` : ''}
          <small>Giá bán: ${formatEthPrice(item.asking_price_wei || '0')}</small>
        </article>
      `;
    }

    return `
      <article class="data-item">
        <strong>#${item.id} - ${item.status}</strong>
        <small>${item.seller_full_name || shortAddress(item.seller_wallet_address)} -> ${item.buyer_full_name || shortAddress(item.buyer_wallet_address)}</small>
        <small>saleId: ${item.sc_sale_id ?? '--'} | Giá: ${formatEthPrice(item.price_wei || '0')}</small>
        <small>seller signed: ${item.seller_signature ? 'yes' : 'no'} | Phí admin: ${item.fee_wei ? formatEthPrice(item.fee_wei) : '--'}</small>
        <button class="text-button" type="button" data-select-transfer="${escapeHtml(item.id)}">Chọn</button>
      </article>
    `;
  }).join('');
}

function renderLedgerTransfers() {
  const list = $('#ledgerTransferList');

  if (!list) return;

  if (!state.ledgerTransfers.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có lịch sử chuyển nhượng</strong><small>Khi có giao dịch được tạo/ký gửi/xác nhận, dữ liệu sẽ hiện ở đây.</small></div>';
    return;
  }

  list.innerHTML = state.ledgerTransfers.map((item) => `
    <article class="data-item ledger-item">
      <div class="ledger-item-main">
        ${item.first_image_gateway_url ? `<img src="${item.first_image_gateway_url}" alt="${item.location || 'Property'}" loading="lazy" />` : ''}
        <div>
          <strong>#${item.id} - ${item.location || 'Không có địa chỉ'}</strong>
          <small>${item.seller_full_name || shortAddress(item.seller_wallet_address)} → ${item.buyer_full_name || shortAddress(item.buyer_wallet_address)}</small>
          <small>Trạng thái: ${formatStatus(item.status)} | Giá: ${formatEthPrice(item.price_wei || '0')}</small>
          <small>propertyId: ${item.sc_property_id ?? '--'} | tokenId: ${item.certificate_token_id ?? '--'} | saleId: ${item.sc_sale_id ?? '--'}</small>
          <small>Phí admin: ${item.fee_wei ? formatEthPrice(item.fee_wei) : '--'} | Deposit tx: ${txLink(item.deposit_tx_hash)}</small>
          <small>Release tx: ${txLink(item.release_tx_hash)}</small>
          <small>Cập nhật: ${formatDateTime(item.updated_at)}</small>
        </div>
      </div>
    </article>
  `).join('');
}

function renderLedgerOwnership() {
  const list = $('#ledgerOwnershipList');

  if (!list) return;

  if (!state.ledgerOwnership.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có NFT sở hữu</strong><small>Mint tài sản để danh sách sở hữu xuất hiện.</small></div>';
    return;
  }

  list.innerHTML = state.ledgerOwnership.map((item) => `
    <article class="data-item ledger-item">
      <div class="ledger-item-main">
        ${item.first_image_gateway_url ? `<img src="${item.first_image_gateway_url}" alt="${item.location || 'Property'}" loading="lazy" />` : ''}
        <div>
          <strong>tokenId #${item.certificate_token_id ?? '--'} - ${item.location || 'Không có địa chỉ'}</strong>
          <small>Chủ sở hữu: ${item.owner_full_name || shortAddress(item.owner_wallet_address)} (${shortAddress(item.owner_wallet_address)})</small>
          <small>propertyId: ${item.sc_property_id ?? '--'} | hồ sơ: #${item.property_id}</small>
          <small>Owner verified: ${item.owner_verified} | trạng thái nền tảng: ${escapeHtml(riskStatusLabel(item))}</small>
          ${riskReason(item) ? `<small>Lý do khóa: ${escapeHtml(riskReason(item))}</small>` : ''}
          <small>Listing: ${escapeHtml(formatListingStatus(item.listing_status))} | saleId: ${item.listing_sale_id ?? '--'} | Giá: ${formatEthPrice(item.asking_price_wei || '0')}</small>
          <small>Certificate URI: ${item.certificate_uri || '--'}</small>
          <small>Số lần chuyển nhượng: ${item.total_changes || 0} | lần cuối: ${formatDateTime(item.last_changed_at)}</small>
        </div>
      </div>
    </article>
  `).join('');
}

function renderLedger() {
  renderLedgerTransfers();
  renderLedgerOwnership();
}

async function loadLedgerData() {
  const [transfers, ownership] = await Promise.all([
    api('/api/ledger/transfers'),
    api('/api/ledger/ownership')
  ]);

  state.ledgerTransfers = transfers.data || [];
  state.ledgerOwnership = ownership.data || [];
  renderLedger();
  renderProfilePage();
  renderHomeNfts();
  renderHomeDashboard();
  renderDataList();
  logAction('Đã tải sổ giao dịch', `${state.ledgerTransfers.length} giao dịch, ${state.ledgerOwnership.length} NFT`);
}

async function checkBackend() {
  const payload = await api('/api/health');
  $('#backendStatus').textContent = 'Đang hoạt động';
  setDot('#backendDot', 'ok');
  logAction('Backend OK', payload.databaseTime || '');
  return payload;
}

async function loadBlockchainStatus() {
  const payload = await api('/api/blockchain/status');
  state.contracts = payload.data;
  renderContracts();
  logAction('Blockchain status loaded', `chainId: ${payload.data?.chainId || '--'}`);
  return payload;
}

async function loadData() {
  const [profiles, properties, transfers, users] = await Promise.all([
    api('/api/profiles'),
    api('/api/properties'),
    api('/api/transfers'),
    state.currentUser?.role === 'admin' ? api('/api/auth/users') : Promise.resolve({ data: [] })
  ]);

  state.profiles = profiles.data || [];
  state.properties = properties.data || [];
  state.transfers = transfers.data || [];
  state.users = users.data || [];
  renderMetrics();
  renderDataList();
  renderRiskAdmin();
  renderProfilePage();
  renderHomeNfts();
  renderHomeDashboard();
  renderSearchResults();
  logAction('Đã tải dữ liệu', `${state.profiles.length} hồ sơ, ${state.properties.length} tài sản`);
}

async function refreshAll() {
  let ok = true;

  try {
    await checkBackend();
  } catch (error) {
    ok = false;
    setDot('#backendDot', 'error');
    logAction('Backend chưa sẵn sàng', error.message);
  }

  try {
    await loadBlockchainStatus();
  } catch (error) {
    ok = false;
    setDot('#chainDot', 'warn');
    $('#chainStatus').textContent = 'Chưa sẵn sàng';
    logAction('Blockchain status chưa sẵn sàng', error.message);
  }

  try {
    await loadData();
  } catch (error) {
    ok = false;
    logAction('Chưa tải được dữ liệu', error.message);
  }

  try {
    await loadLedgerData();
  } catch (error) {
    ok = false;
    logAction('Chưa tải được sổ giao dịch', error.message);
  }

  showToast(ok ? 'Đã làm mới dashboard' : 'Một phần hệ thống chưa sẵn sàng');
}

async function setUserPlatformAccess(active) {
  const body = collectForm('#riskUserForm');

  if (!body.user_id) {
    throw new Error('Hãy chọn hoặc nhập User ID cần xử lý');
  }

  if (!active && !body.reason) {
    throw new Error('Hãy nhập lý do khóa user');
  }

  const payload = await api(`/api/auth/users/${body.user_id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({
      active,
      reason: body.reason
    })
  });

  logAction(active ? 'Đã mở lại user' : 'Đã khóa user', `id: ${payload.data.id}`);
  showToast(active ? 'User đã được mở lại quyền sử dụng nền tảng' : 'User đã bị khóa quyền sử dụng nền tảng');
  await loadData();
}

async function setNftPlatformAccess(active) {
  const body = collectForm('#riskNftForm');

  if (!body.property_id) {
    throw new Error('Hãy chọn hoặc nhập NFT / Property ID cần xử lý');
  }

  if (!active && !body.reason) {
    throw new Error('Hãy nhập lý do khóa NFT');
  }

  const payload = await api(`/api/properties/${body.property_id}/risk`, {
    method: 'PATCH',
    body: JSON.stringify({
      active,
      risk_reason: body.reason
    })
  });

  const chainSync = payload.data.chainSync;
  const chainNote = chainSync?.attempted
    ? (chainSync.ok ? ` · on-chain ${shortAddress(chainSync.txHash)}` : ' · chưa đồng bộ on-chain')
    : '';

  logAction(active ? 'Đã mở lại NFT' : 'Đã khóa NFT', `property id: ${payload.data.id}${chainNote}`);
  showToast(active
    ? `NFT đã được mở lại trên nền tảng${chainNote}`
    : `NFT đã bị khóa khỏi marketplace${chainNote}`);
  await loadData();
  await loadLedgerData();
}

async function connectWallet() {
  if (!window.ethereum) {
    setDot('#walletDot', 'error');
    showToast('Không tìm thấy MetaMask trong browser này');
    return;
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });

  state.account = accounts[0] || null;
  state.chainId = chainId;
  updateWalletUi(state.account, state.chainId);
  logAction('Đã kết nối MetaMask', shortAddress(state.account));
}

function buildManualProfilePayload(body) {
  const wallet = body.wallet_address || getActiveWallet();
  const identity = String(body.identify_id || '').replace(/\D/g, '');

  if (!wallet) {
    throw new Error('Cần đăng nhập hoặc kết nối ví trước khi lưu hồ sơ.');
  }

  if (!identity) {
    throw new Error('Số CCCD không hợp lệ.');
  }

  const walletKey = String(wallet).replace(/^0x/i, '').slice(0, 10).toUpperCase();
  const personId = `PERSON-${identity}`;

  return {
    ...body,
    wallet_address: wallet,
    identify_id: identity,
    country: 'Viet Nam',
    backend_person_id: personId,
    backend_person_hash: `${personId}-${walletKey}-HASH`,
    profile_data_hash: `${personId}-${walletKey}-DATA`
  };
}

async function createProfile() {
  const form = $('#profileForm');
  if (form && !form.reportValidity()) {
    return;
  }

  const body = buildManualProfilePayload(collectForm('#profileForm'));
  const payload = await api('/api/profiles', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  logAction('Đã lưu hồ sơ cá nhân', `id: ${payload.data.id}`);
  try {
    const chainPayload = await registerPersonWithBackend(body);
    logAction('Đã xác thực hồ sơ', chainPayload.data.txHash || '');
    showToast('Hồ sơ đã được lưu và xác thực ví thành công.');
  } catch (error) {
    logAction('Xác thực hồ sơ chưa hoàn tất', error.message);
    showToast('Hồ sơ đã được lưu. Trạng thái xác thực ví sẽ được cập nhật sau khi hệ thống đồng bộ.');
  }

  await loadData();
}

async function registerPersonWithBackend(body) {
  const { address, email, phone, ...chainBody } = body;

  return api('/api/blockchain/registry/register-person', {
    method: 'POST',
    body: JSON.stringify({
      ...chainBody,
      verified: true
    })
  });
}

function renderPropertyImages() {
  const list = $('#propertyImageList');

  if (!list) return;

  if (!state.propertyImages.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có ảnh IPFS</strong><small>Upload ảnh tài sản để tạo metadata NFT.</small></div>';
    return;
  }

  list.innerHTML = state.propertyImages.map((image, index) => `
    <article class="image-card">
      <button class="image-card-preview" type="button" data-slideshow-source="propertyImages" data-slideshow-index="${index}">
        <img src="${image.gateway_url}" alt="${image.caption || image.original_name || 'Property image'}" loading="lazy" />
      </button>
      <div>
        <strong>${image.caption || image.original_name || 'Property image'}</strong>
        <small>${image.image_uri}</small>
      </div>
    </article>
  `).join('');
}

function normalizeSlideshowImages(images = []) {
  return images
    .map((image) => ({
      url: image.gateway_url || image.url || image.src || '',
      title: image.caption || image.original_name || image.title || 'Ảnh tài sản',
      meta: image.image_uri || image.uri || ''
    }))
    .filter((image) => image.url);
}

function renderImageSlideshow() {
  const image = state.slideshowImages[state.slideshowIndex];
  const img = $('#imageSlideshowImg');
  const title = $('#imageSlideshowTitle');
  const meta = $('#imageSlideshowMeta');

  if (!image || !img || !title || !meta) return;

  img.src = image.url;
  img.alt = image.title || 'Property image preview';
  title.textContent = image.title || 'Ảnh tài sản';
  meta.textContent = `${state.slideshowIndex + 1} / ${state.slideshowImages.length}${image.meta ? ` · ${image.meta}` : ''}`;
}

function openImageSlideshow(images = [], index = 0) {
  const normalized = normalizeSlideshowImages(images);

  if (!normalized.length) {
    showToast('Chưa có ảnh để xem slideshow.');
    return;
  }

  state.slideshowImages = normalized;
  state.slideshowIndex = Math.max(0, Math.min(Number(index) || 0, normalized.length - 1));

  $('#imageSlideshowBackdrop').hidden = false;
  $('#imageSlideshowModal').hidden = false;
  renderImageSlideshow();
}

function closeImageSlideshow() {
  const backdrop = $('#imageSlideshowBackdrop');
  const modal = $('#imageSlideshowModal');

  if (backdrop) backdrop.hidden = true;
  if (modal) modal.hidden = true;
}

function moveImageSlideshow(direction) {
  if (!state.slideshowImages.length) return;

  const count = state.slideshowImages.length;
  state.slideshowIndex = (state.slideshowIndex + direction + count) % count;
  renderImageSlideshow();
}

async function checkIpfsStatus() {
  const payload = await api('/api/ipfs/status');
  const config = payload.data;
  logAction('IPFS status', `Pinata: ${config.pinataConfigured ? 'configured' : 'missing'} | Gateway: ${config.gateway}`);
  state.ipfsGateway = config.gateway;
  showToast(config.pinataConfigured ? 'Pinata đã cấu hình' : 'Chưa có PINATA_JWT trong backend');
}

async function loadPropertyImages() {
  const body = collectForm('#ipfsForm');
  const payload = await api(`/api/properties/${body.property_id}/images`);
  state.propertyImages = payload.data || [];
  renderPropertyImages();
  logAction('Đã tải ảnh IPFS', `${state.propertyImages.length} images`);
}

async function uploadPropertyImage() {
  const form = $('#ipfsForm');
  const body = collectForm('#ipfsForm');
  const files = Array.from(form.elements.image.files || []);

  if (!files.length) {
    throw new Error('Hãy chọn ảnh tài sản trước khi upload');
  }

  const startOrder = Number(body.sort_order || 0);
  const uploads = [];

  for (const [index, file] of files.entries()) {
    const data = new FormData();
    data.append('image', file);
    data.append('caption', files.length > 1 ? `${body.caption || 'Ảnh tài sản'} ${index + 1}` : (body.caption || ''));
    data.append('sort_order', String(startOrder + index));

    const payload = await api(`/api/properties/${body.property_id}/images`, {
      method: 'POST',
      body: data
    });

    uploads.push(payload.data);
    logAction('Đã upload ảnh IPFS', payload.data.image_uri);
  }

  showToast(`Đã upload ${uploads.length} ảnh tài sản lên IPFS`);
  await loadPropertyImages();
  return;

  const data = new FormData();
  data.append('image', file);
  data.append('caption', body.caption || '');
  data.append('sort_order', body.sort_order || '0');

  const payload = await api(`/api/properties/${body.property_id}/images`, {
    method: 'POST',
    body: data
  });

  logAction('Đã upload ảnh IPFS', payload.data.image_uri);
  showToast('Ảnh tài sản đã được pin lên IPFS');
  await loadPropertyImages();
}

async function uploadLegalDocument() {
  const form = $('#ipfsForm');
  const body = collectForm('#ipfsForm');
  const fileInput = form.querySelector('[name="legal_document"]');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    throw new Error('Hãy chọn file PDF pháp lý trước khi upload');
  }

  const file = fileInput.files[0];
  const propertyId = body.property_id;
  if (!propertyId) {
    throw new Error('Hãy điền ID hồ sơ tài sản trước');
  }

  const data = new FormData();
  data.append('image', file);
  // Luôn dùng caption cố định để findUploadedDocument() nhận diện đúng file pháp lý,
  // không lấy ô "Chú thích ảnh" chung (ô đó chỉ dành cho ảnh tài sản, dùng chung sẽ làm sai caption của PDF)
  data.append('caption', 'Legal document');

  const payload = await api(`/api/properties/${propertyId}/images`, {
    method: 'POST',
    body: data
  });

  // Update property form legal_document_hash with returned CID
  const cid = payload.data && (payload.data.image_cid || payload.data.cid || payload.data.pinata?.cid);
  if (cid) {
    const legalInput = $('#propertyForm [name="legal_document_hash"]');
    if (legalInput) legalInput.value = cid;
  }

  showToast('File pháp lý đã được upload lên IPFS.');
  await loadPropertyImages();
}

// valuation upload removed for demo

async function uploadPdfToIpfs() {
  const form = $('#ipfsForm');
  const body = collectForm('#ipfsForm');
  const failedSteps = [];
  let uploadedCount = 0;

  // Upload file pháp lý
  try {
    const legalInput = form.querySelector('[name="legal_document"]');
    if (legalInput && legalInput.files && legalInput.files.length > 0) {
      await uploadLegalDocument();
      uploadedCount++;
    }
  } catch (err) {
    console.error('uploadLegalDocument failed', err);
    failedSteps.push(`File pháp lý: ${err.message || err}`);
  }

  // Upload file thẩm định giá
  try {
    const valInput = form.querySelector('[name="valuation_report"]');
    if (valInput && valInput.files && valInput.files.length > 0) {
      const file = valInput.files[0];
      const data = new FormData();
      data.append('image', file);
      // Luôn dùng caption cố định để findUploadedDocument() nhận diện đúng file thẩm định giá
      data.append('caption', 'Valuation report');

      const payload = await api(`/api/properties/${body.property_id}/images`, {
        method: 'POST',
        body: data
      });

      // try to set valuation URI on form if returned
      const gatewayUrl = payload.data && (payload.data.gateway_url || payload.data.pinata?.gatewayUrl);
      const cid = payload.data && (payload.data.image_cid || payload.data.cid || payload.data.pinata?.cid);
      if (gatewayUrl) {
        const valuationInput = $('#propertyForm [name="valuation_report_uri"]');
        if (valuationInput) valuationInput.value = gatewayUrl;
      } else if (cid) {
        const valuationInput = $('#propertyForm [name="valuation_report_uri"]');
        if (valuationInput) valuationInput.value = `ipfs://${cid}`;
      }
      uploadedCount++;
    }
  } catch (err) {
    console.error('uploadValuation failed', err);
    failedSteps.push(`File thẩm định giá: ${err.message || err}`);
  }

  if (!uploadedCount && !failedSteps.length) {
    showToast('Hãy chọn ít nhất 1 file PDF (pháp lý hoặc thẩm định giá) trước khi upload.');
    return;
  }

  if (failedSteps.length) {
    showToast(`Một số file PDF upload thất bại - ${failedSteps.join(' | ')}`);
    logAction('Upload PDF IPFS có lỗi', failedSteps.join(' | '));
  } else {
    showToast(`Hoàn tất upload ${uploadedCount} file PDF lên IPFS.`);
  }

  await loadPropertyImages();
}

async function createPropertyMetadata() {
  const body = collectForm('#ipfsForm');
  const payload = await api(`/api/properties/${body.property_id}/metadata`, {
    method: 'POST',
    body: JSON.stringify({
      name: body.metadata_name,
      description: body.metadata_description
    })
  });

  const uri = payload.data.uri;
  $('#propertyForm [name="certificate_uri"]').value = uri;
  $('#propertyChainForm [name="property_db_id"]').value = body.property_id;
  logAction('Đã tạo NFT metadata IPFS', uri);
  showToast('Metadata NFT đã được tạo. Nếu NFT đã mint, bấm "Cập nhật tokenURI on-chain" để MetaMask hiển thị đúng avatar.');
  await loadData();
}

async function updateCertificateUriOnChain() {
  const body = collectForm('#ipfsForm');
  const propertyId = body.property_id;
  const certificateUri = $('#propertyForm [name="certificate_uri"]').value;

  if (!propertyId) {
    throw new Error('Hãy nhập ID hồ sơ tài sản trước.');
  }

  if (!certificateUri) {
    throw new Error('Chưa có certificate_uri. Hãy bấm "Tạo metadata NFT" trước.');
  }

  const payload = await api(`/api/properties/${propertyId}/certificate-uri`, {
    method: 'PATCH',
    body: JSON.stringify({ certificate_uri: certificateUri })
  });

  logAction('Đã cập nhật tokenURI on-chain', payload.data.receipt?.txHash || '');
  showToast('Đã cập nhật tokenURI trên blockchain. Mở lại NFT trong MetaMask (hoặc xóa rồi thêm lại) để thấy avatar mới.');
  await loadData();
}

async function createProperty() {
  const body = collectForm('#propertyForm');
  const askingPriceWei = ethToWei(body.asking_price_eth, 'Giá bán ETH');
  const payload = await api('/api/properties', {
    method: 'POST',
    body: JSON.stringify({
      ...body,
      asking_price_wei: askingPriceWei,
      active: true
    })
  });

  logAction('Đã lưu hồ sơ tài sản', `id: ${payload.data.id}`);
  $('#propertyChainForm [name="property_db_id"]').value = payload.data.id;
  $('#ipfsForm [name="property_id"]').value = payload.data.id;
  showToast('Hồ sơ tài sản đã được lưu');
  await loadData();
}

async function registerPropertyOnChain() {
  const body = collectForm('#propertyForm');
  const ownerProfile = state.profiles.find((profile) => String(profile.id) === String(body.owner_profile_id));

  if (!ownerProfile) {
    throw new Error('Không tìm thấy owner_profile_id trong danh sách profiles. Hãy bấm Tải dữ liệu trước.');
  }

  const registry = await getRegistryContract();
  const backendPropertyId = toBytes32(body.backend_property_id);
  const tx = await registry.registerProperty(
    backendPropertyId,
    requireAddress(ownerProfile.wallet_address, 'owner wallet'),
    toBytes32(body.property_data_hash),
    toBytes32(body.legal_document_hash),
    body.location,
    body.certificate_uri
  );

  logAction('Đã gửi mint NFT', tx.hash);
  const receipt = await tx.wait();
  const scPropertyId = await registry.propertyIdByBackend(backendPropertyId);
  const chainProperty = await registry.getProperty(scPropertyId);
  const tokenId = chainProperty.certificateTokenId ?? chainProperty[4];
  const txHash = receipt.hash || tx.hash;

  $('#propertyChainForm [name="sc_property_id"]').value = scPropertyId.toString();
  $('#propertyChainForm [name="certificate_token_id"]').value = tokenId.toString();
  $('#propertyChainForm [name="registry_tx_hash"]').value = txHash;

  const propertyDbId = $('#propertyChainForm [name="property_db_id"]').value
    || state.properties.find((item) => item.backend_property_id === body.backend_property_id)?.id;

  if (propertyDbId) {
    await api(`/api/properties/${propertyDbId}/blockchain`, {
      method: 'PATCH',
      body: JSON.stringify({
        sc_property_id: scPropertyId.toString(),
        certificate_token_id: tokenId.toString(),
        registry_tx_hash: txHash
      })
    });
  }

  logAction('Đã mint NFT certificate', txHash);
  showToast('NFT tài sản đã được mint');
  await loadData();
}

async function patchPropertyChain() {
  const body = collectForm('#propertyChainForm');
  const propertyDbId = body.property_db_id;
  delete body.property_db_id;

  const payload = await api(`/api/properties/${propertyDbId}/blockchain`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });

  logAction('Đã cập nhật mã NFT của tài sản', `id: ${payload.data.id}`);
  showToast('Đã lưu mã NFT và tokenId');
  await loadData();
}

async function createTransfer() {
  const body = collectForm('#transferForm');
  const priceWei = ethToWei(body.price_eth, 'Giá ETH');
  const payload = await api('/api/transfers', {
    method: 'POST',
    body: JSON.stringify({
      backend_transaction_id: body.backend_transaction_id,
      backend_transaction_hash: body.backend_transaction_hash,
      property_id: body.property_id,
      buyer_profile_id: body.buyer_profile_id,
      price_wei: priceWei,
      document_hash: body.document_hash
    })
  });

  logAction('Đã tạo hồ sơ giao dịch', `id: ${payload.data.id}`);
  $('#releaseForm [name="transfer_db_id"]').value = payload.data.id;
  showToast('Hồ sơ giao dịch đã được lưu');
  await loadData();
}

async function signSellerAcceptance() {
  const releaseBody = collectForm('#releaseForm');

  if (!releaseBody.transfer_db_id) {
    throw new Error('Hãy nhập ID hồ sơ giao dịch trước khi seller ký');
  }

  const signer = await getSigner();
  const sellerAddress = await signer.getAddress();
  let transfer = state.transfers.find((item) => String(item.id) === String(releaseBody.transfer_db_id));

  if (!transfer) {
    await loadData();
    transfer = state.transfers.find((item) => String(item.id) === String(releaseBody.transfer_db_id));
  }

  if (!transfer) {
    throw new Error('Không tìm thấy hồ sơ giao dịch. Hãy bấm Tải dữ liệu rồi chọn đúng hồ sơ.');
  }

  fillTransferFormsFromRecord(transfer);

  if (!sameWallet(sellerAddress, transfer.seller_wallet_address)) {
    throw new Error(`Chỉ seller của hồ sơ #${transfer.id} được ký. Seller: ${shortAddress(transfer.seller_wallet_address)}, ví hiện tại: ${shortAddress(sellerAddress)}.`);
  }

  if (transfer.status !== 'created') {
    throw new Error(`Chỉ ký được hồ sơ đang ở trạng thái created. Hồ sơ #${transfer.id} hiện là ${transfer.status}.`);
  }

  const payload = await api(`/api/transfers/${releaseBody.transfer_db_id}/seller-message`);
  const signature = await signer.signMessage(payload.data.message);
  const updated = await api(`/api/transfers/${releaseBody.transfer_db_id}/seller-signature`, {
    method: 'PATCH',
    body: JSON.stringify({ signature })
  });

  logAction('Seller đã ký chấp nhận bán', `${shortAddress(sellerAddress)} · id ${updated.data.id}`);
  showToast('Đã lưu chữ ký chấp nhận bán của seller');
  await loadData();
}

async function createSaleOnChain() {
  const body = collectForm('#transferForm');
  const releaseBody = collectForm('#releaseForm');

  if (!releaseBody.transfer_db_id) {
    throw new Error('Hãy nhập ID hồ sơ giao dịch trước khi tạo giao dịch bán');
  }

  const transfer = state.transfers.find((item) => String(item.id) === String(releaseBody.transfer_db_id));
  if (!transfer) {
    throw new Error('Không tìm thấy hồ sơ giao dịch. Hãy bấm Tải dữ liệu trước.');
  }

  if (!transfer.seller_signature) {
    throw new Error('Seller phải ký chấp nhận bán trước khi tạo giao dịch bán');
  }

  const escrow = await getEscrowContract();
  const backendTransactionId = toBytes32(body.backend_transaction_id);
  const priceWei = ethToWei(body.price_eth, 'Giá ETH');
  const tx = await escrow.createCertificateSale(
    body.sc_property_id,
    requireAddress(body.buyer_wallet_address, 'buyer_wallet_address'),
    priceWei,
    backendTransactionId,
    toBytes32(body.document_hash)
  );

  logAction('Đã gửi createCertificateSale', tx.hash);
  const receipt = await tx.wait();
  const saleId = await escrow.saleIdByBackendTransactionId(backendTransactionId);
  $('#releaseForm [name="sale_id"]').value = saleId.toString();

  if (releaseBody.transfer_db_id) {
    await api(`/api/transfers/${releaseBody.transfer_db_id}/sale`, {
      method: 'PATCH',
      body: JSON.stringify({
        sc_sale_id: saleId.toString(),
        create_tx_hash: tx.hash
      })
    });
  }

  logAction('Giao dịch bán đã được tạo', `block ${receipt.blockNumber}`);
  showToast('Giao dịch bán đã được tạo');
  await loadData();
}

async function approveNft() {
  const body = collectForm('#transferForm');
  const nft = await getNftContract();
  const escrowAddress = getContractAddress('escrow');
  const tx = await nft.approve(escrowAddress, body.certificate_token_id);

  logAction('Đã gửi approve NFT', tx.hash);
  const receipt = await tx.wait();
  logAction('Approve NFT hoàn tất', `block ${receipt.blockNumber}`);
  showToast('NFT đã approve cho Escrow');
}

async function depositNft() {
  const body = collectForm('#releaseForm');
  const transferBody = collectForm('#transferForm');

  if (!body.transfer_db_id || !body.sale_id) {
    throw new Error('Hãy nhập ID hồ sơ giao dịch và saleId trước khi deposit NFT');
  }

  const escrow = await getEscrowContract();
  const feeWei = await escrow.getTransactionFee(ethToWei(transferBody.price_eth, 'Giá ETH'));
  const tx = await escrow.depositCertificate(body.sale_id, { value: feeWei });

  logAction('Đã gửi deposit NFT kèm phí', `${tx.hash} · fee ${feeWei.toString()} wei`);
  const receipt = await tx.wait();
  $('#releaseForm [name="tx_hash"]').value = tx.hash;
  logAction('Deposit NFT hoàn tất', `block ${receipt.blockNumber}`);
  showToast(`NFT đã vào Escrow. Phí ${formatEthPrice(feeWei.toString())} đã chuyển vào ${shortAddress(state.contracts?.feeRecipient)}.`);

  if (body.transfer_db_id) {
    await api(`/api/transfers/${body.transfer_db_id}/deposit`, {
      method: 'PATCH',
      body: JSON.stringify({
        deposit_tx_hash: tx.hash,
        fee_wei: feeWei.toString()
      })
    });
    await loadData();
  }
}

async function markDepositSql() {
  const body = collectForm('#releaseForm');
  const transferBody = collectForm('#transferForm');
  const escrow = await getEscrowContract();
  const feeWei = await escrow.getTransactionFee(ethToWei(transferBody.price_eth, 'Giá ETH'));
  const payload = await api(`/api/transfers/${body.transfer_db_id}/deposit`, {
    method: 'PATCH',
    body: JSON.stringify({
      deposit_tx_hash: body.tx_hash,
      fee_wei: feeWei.toString()
    })
  });

  logAction('Giao dịch đã được đánh dấu ký gửi', `id: ${payload.data.id}`);
  showToast('Đã cập nhật trạng thái ký gửi');
  await loadData();
}

async function releaseByBackend() {
  const body = collectForm('#releaseForm');

  if (!body.transfer_db_id || !body.sale_id) {
    throw new Error('Hãy nhập ID hồ sơ giao dịch và saleId trước khi release');
  }

  const release = await api('/api/blockchain/escrow/release', {
    method: 'POST',
    body: JSON.stringify({
      sale_id: body.sale_id,
      transfer_id: body.transfer_db_id
    })
  });

  const txHash = release.data.txHash || body.tx_hash;
  $('#releaseForm [name="tx_hash"]').value = txHash || '';
  logAction('Admin đã chuyển NFT cho buyer', txHash || '');

  if (body.transfer_db_id) {
    await api(`/api/transfers/${body.transfer_db_id}/release`, {
      method: 'PATCH',
      body: JSON.stringify({ release_tx_hash: txHash })
    });
    logAction('Giao dịch đã hoàn tất', `id: ${body.transfer_db_id}`);
  }

  showToast('Admin đã chuyển NFT cho buyer');
  await loadData();
}

async function cancelTransfer() {
  const body = collectForm('#releaseForm');

  if (!body.transfer_db_id) {
    throw new Error('Hãy nhập ID hồ sơ giao dịch cần hủy');
  }

  let cancelTxHash = body.tx_hash || '';

  if (body.sale_id) {
    const cancel = await api('/api/blockchain/escrow/cancel', {
      method: 'POST',
      body: JSON.stringify({
        sale_id: body.sale_id,
        transfer_id: body.transfer_db_id
      })
    });
    cancelTxHash = cancel.data.txHash || cancelTxHash;
    $('#releaseForm [name="tx_hash"]').value = cancelTxHash;
    logAction('Giao dịch bán đã hủy', cancelTxHash);
  }

  const payload = await api(`/api/transfers/${body.transfer_db_id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ cancel_tx_hash: cancelTxHash })
  });

  logAction('Hồ sơ giao dịch đã hủy', `id: ${payload.data.id}`);
  showToast('Đã hủy hồ sơ giao dịch');
  await loadData();
}

async function verifyOwnership() {
  const body = collectForm('#verifyForm');
  const account = requireAddress(body.account, 'account');
  const payload = await api(`/api/blockchain/registry/ownership/${body.property_id}/${account}`);
  logAction('verifyOwnership', `${shortAddress(account)} = ${payload.data.verified}`);
  showToast(`Kết quả verifyOwnership: ${payload.data.verified}`);
}

async function checkNft() {
  const body = collectForm('#verifyForm');
  const payload = await api(`/api/blockchain/nft/${body.token_id}`);
  logAction('NFT ownerOf/tokenURI', `owner: ${shortAddress(payload.data.owner)} | tokenURI: ${payload.data.tokenUri}`);
  showToast(`Owner NFT: ${shortAddress(payload.data.owner)}`);
}

function bindClick(selector, action) {
  const element = $(selector);
  if (element) element.addEventListener('click', () => run(action));
}

function bindActions() {
  const bindOptional = (selector, event, handler) => {
    const element = $(selector);
    if (element) element.addEventListener(event, handler);
  };

  bindOptional('#loginBtn', 'click', () => run(login));
  bindOptional('#walletConnectLoginBtn', 'click', showWalletConnectInfo);
  bindOptional('#setupAdminBtn', 'click', () => run(setupAdmin));
  bindOptional('#logoutBtn', 'click', logout);
  bindOptional('#viewProfileBtn', 'click', () => toggleProfileDrawer());
  bindOptional('#profileDrawerBtn', 'click', () => toggleProfileDrawer());
  bindOptional('#profileDrawerCloseBtn', 'click', closeProfileDrawer);
  bindOptional('#profileDrawerBackdrop', 'click', closeProfileDrawer);
  bindOptional('#propertyDetailCloseBtn', 'click', closePropertyDetail);
  bindOptional('#propertyDetailBackdrop', 'click', closePropertyDetail);
  bindOptional('#imageSlideshowCloseBtn', 'click', closeImageSlideshow);
  bindOptional('#imageSlideshowBackdrop', 'click', closeImageSlideshow);
  bindOptional('#imageSlideshowPrevBtn', 'click', () => moveImageSlideshow(-1));
  bindOptional('#imageSlideshowNextBtn', 'click', () => moveImageSlideshow(1));
  bindOptional('#mockEkycCloseBtn', 'click', closeMockEkycModal);
  bindOptional('#mockEkycCancelBtn', 'click', closeMockEkycModal);
  bindOptional('#mockEkycBackdrop', 'click', closeMockEkycModal);
  bindOptional('#mockEkycForm', 'submit', completeMockEkyc);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('#imageSlideshowModal')?.hidden) {
        closeImageSlideshow();
        return;
      }

      closeProfileDrawer();
      closePropertyDetail();
      closeMockEkycModal();
    } else if (event.key === 'ArrowLeft' && !$('#imageSlideshowModal')?.hidden) {
      moveImageSlideshow(-1);
    } else if (event.key === 'ArrowRight' && !$('#imageSlideshowModal')?.hidden) {
      moveImageSlideshow(1);
    }
  });
  bindOptional('#profileRefreshBtn', 'click', () => run(refreshAll));
  bindOptional('#refreshNftMarketBtn', 'click', () => run(refreshAll));
  bindOptional('#refreshHomeActivityBtn', 'click', () => run(refreshAll));
  $$('[data-profile-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(`#${button.dataset.profileTarget}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  bindOptional('#authApiBaseInput', 'change', (event) => {
    setApiBase(event.target.value);
    run(loadSetupStatus);
  });

  bindOptional('#globalSearchInput', 'input', renderSearchResults);
  bindOptional('#globalSearchInput', 'focus', renderSearchResults);

  $$('[data-drawer-tab]').forEach((button) => {
    button.addEventListener('click', () => setDrawerTab(button.dataset.drawerTab));
  });

  $$('[data-nav-page]').forEach((link) => {
    link.addEventListener('click', () => {
      setPage(link.dataset.navPage);
    });
  });

  window.addEventListener('hashchange', () => {
    setPage(getPageFromHash());
  });

  syncApiInputs();
  bindOptional('#apiBaseInput', 'change', (event) => {
    setApiBase(event.target.value);
  });

  bindOptional('#connectWalletBtn', 'click', () => run(connectWallet));
  bindOptional('#refreshAllBtn', 'click', () => run(refreshAll));
  bindOptional('#checkSystemBtn', 'click', () => run(refreshAll));
  bindClick('#suspendUserBtn', () => setUserPlatformAccess(false));
  bindClick('#restoreUserBtn', () => setUserPlatformAccess(true));
  bindClick('#disableNftBtn', () => setNftPlatformAccess(false));
  bindClick('#restoreNftBtn', () => setNftPlatformAccess(true));
  bindOptional('#loadDataBtn', 'click', () => run(loadData));
  bindOptional('#loadLedgerBtn', 'click', () => run(loadLedgerData));
  // checkIpfsBtn removed from UI
  bindOptional('#loadPropertyImagesBtn', 'click', () => run(loadPropertyImages));
  // Upload ảnh và upload PDF tách riêng 2 nút
  bindOptional('#uploadImagesBtn', 'click', () => run(uploadPropertyImage));
  bindOptional('#uploadPdfBtn', 'click', () => run(uploadPdfToIpfs));
  bindOptional('#createMetadataBtn', 'click', () => run(createPropertyMetadata));

  // Tự tạo nút "Cập nhật tokenURI on-chain" cạnh nút "Tạo metadata NFT" vì NFT đã mint
  // cần gọi registry.updateCertificateURI() on-chain thì MetaMask mới đổi avatar (xem updateCertificateUriOnChain()).
  const createMetadataBtnEl = $('#createMetadataBtn');
  if (createMetadataBtnEl && !$('#updateCertificateUriBtn')) {
    const updateUriBtn = document.createElement('button');
    updateUriBtn.id = 'updateCertificateUriBtn';
    updateUriBtn.type = 'button';
    updateUriBtn.className = createMetadataBtnEl.className;
    updateUriBtn.textContent = 'Cập nhật tokenURI on-chain';
    createMetadataBtnEl.insertAdjacentElement('afterend', updateUriBtn);
    updateUriBtn.addEventListener('click', () => run(updateCertificateUriOnChain));
  }
  bindOptional('#createProfileBtn', 'click', () => run(createProfile));
  bindOptional('#createPropertyBtn', 'click', () => run(createProperty));
  bindOptional('#registerPropertyChainBtn', 'click', () => run(registerPropertyOnChain));
  bindOptional('#patchPropertyChainBtn', 'click', () => run(patchPropertyChain));
  bindClick('#listNftBtn', listNftForSale);
  bindClick('#cancelListingBtn', cancelListing);
  bindOptional('#verifyOwnershipBtn', 'click', () => run(verifyOwnership));
  bindOptional('#checkNftBtn', 'click', () => run(checkNft));
  const clearLogButton = $('#clearLogBtn');
  if (clearLogButton) {
    clearLogButton.addEventListener('click', () => {
      const activityLog = $('#activityLog');
      if (activityLog) activityLog.innerHTML = '';
    });
  }

  $$('[data-fill-wallet]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(`#${button.dataset.fillWallet}`);
      target.value = state.account || '';
      showToast(state.account ? 'Đã điền ví hiện tại' : 'Chưa kết nối MetaMask');
    });
  });

  document.addEventListener('click', (event) => {
    const dashboardAction = event.target.closest('[data-dashboard-action]');
    if (dashboardAction) {
      const action = dashboardAction.dataset.dashboardAction;

      if (action === 'connect-wallet') {
        run(connectWallet);
      } else if (action === 'open-ekyc') {
        run(async () => {
          if (!getActiveWallet()) {
            await connectWallet();
          }
          if (isWalletEkycReady(getActiveWallet())) {
            showToast('Đã eKYC thành công');
          } else {
            openMockEkycModal();
          }
        });
      } else if (action === 'scroll-market') {
        setPage('home');
        $('#homeNftMarket')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (action === 'open-admin-risk') {
        setPage('system');
        $('#riskAdminList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    const routeButton = event.target.closest('[data-nav-page]');
    if (routeButton) {
      setPage(routeButton.dataset.navPage);
      return;
    }

    const transferButton = event.target.closest('[data-select-transfer]');
    if (transferButton) {
      const transfer = state.transfers.find((item) => String(item.id) === String(transferButton.dataset.selectTransfer));
      if (transfer) {
        fillTransferFormsFromRecord(transfer);
        setPage('transfers');
        showToast(`Đã chọn hồ sơ giao dịch #${transfer.id}`);
      }
      return;
    }

    const buyButton = event.target.closest('[data-buy-property]');
    if (buyButton) {
      closePropertyDetail();
      run(() => buyListedNft(buyButton.dataset.buyProperty));
      return;
    }

    const listButton = event.target.closest('[data-list-property]');
    if (listButton) {
      run(() => prepareListNft(listButton.dataset.listProperty));
      return;
    }

    const cancelListingButton = event.target.closest('[data-cancel-listing-property]');
    if (cancelListingButton) {
      run(async () => {
        prepareListNft(cancelListingButton.dataset.cancelListingProperty);
        await cancelListing();
      });
      return;
    }

    const riskUserButton = event.target.closest('[data-risk-user]');
    if (riskUserButton) {
      fillRiskUser(riskUserButton.dataset.riskUser);
      return;
    }

    const riskPropertyButton = event.target.closest('[data-risk-property]');
    if (riskPropertyButton) {
      fillRiskNft(riskPropertyButton.dataset.riskProperty);
      return;
    }

    const walletButton = event.target.closest('[data-open-wallet], [data-search-wallet]');
    if (walletButton) {
      const wallet = walletButton.dataset.openWallet || walletButton.dataset.searchWallet || '';
      if (wallet) {
        closePropertyDetail();
        openProfileDrawer(wallet);
        $('#searchResults').hidden = true;
      }
      return;
    }

    const propertyDetailButton = event.target.closest('[data-property-detail]');
    if (propertyDetailButton) {
      openPropertyDetail(propertyDetailButton.dataset.propertyDetail);
      return;
    }

    const downloadButton = event.target.closest('[data-download-file]');
    if (downloadButton) {
      run(() => downloadFileAsBlob(downloadButton.dataset.downloadFile, downloadButton.dataset.downloadName));
      return;
    }

    const slideshowButton = event.target.closest('[data-slideshow-source]');
    if (slideshowButton) {
      const source = slideshowButton.dataset.slideshowSource;
      const index = Number(slideshowButton.dataset.slideshowIndex || 0);
      const images = source === 'detailGallery' ? state.detailGalleryImages : state.propertyImages;
      openImageSlideshow(images, index);
      return;
    }

    if (!event.target.closest('.topbar-search')) {
      const box = $('#searchResults');
      if (box) box.hidden = true;
    }
  });

  $$('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.tab').forEach((tab) => tab.classList.remove('active'));
      button.classList.add('active');
      state.activeTable = button.dataset.table;
      renderDataList();
    });
  });

  $$('.spotlight').forEach((card) => {
    card.addEventListener('mousemove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--y', `${event.clientY - rect.top}px`);
    });
  });

  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', (accounts) => {
      updateWalletUi(accounts[0] || null, state.chainId);
    });

    window.ethereum.on?.('chainChanged', (chainId) => {
      updateWalletUi(state.account, chainId);
    });
  }
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    console.error(error);
    logAction('Lỗi', error.message);
    showToast(error.message);
  }
}

function init() {
  bindActions();
  state.page = getPageFromHash();
  setPage(state.page);
  renderMetrics();
  renderDataList();
  renderLedger();
  renderProfilePage();
  renderHomeNfts();
  renderHomeDashboard();
  renderProfileDrawer();
  closeProfileDrawer();
  logAction('Frontend sẵn sàng', state.apiBase);
  run(restoreSession);
}

document.addEventListener('DOMContentLoaded', init);