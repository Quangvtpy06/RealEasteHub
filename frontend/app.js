const NFT_ABI = [
  'function approve(address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getApproved(uint256 tokenId) view returns (address)'
];

const ESCROW_ABI = [
  'function createCertificateSale(uint256 propertyId, address buyer, uint256 priceWei, bytes32 backendTransactionId, bytes32 documentHash) returns (uint256)',
  'function depositCertificate(uint256 saleId) external',
  'function getCertificateSale(uint256 saleId) view returns (tuple(uint256 id,uint256 propertyId,uint256 certificateTokenId,address seller,address buyer,uint256 priceWei,bytes32 backendTransactionId,bytes32 documentHash,uint8 status,uint256 createdAt,uint256 depositedAt,uint256 releasedAt,uint256 cancelledAt,address releasedBy))'
];

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
  ledgerTransfers: [],
  ledgerOwnership: [],
  appUsers: [],
  propertyImages: [],
  activeTable: 'profiles',
  page: 'home',
  mode: 'user',
  token: localStorage.getItem('propertyChainToken') || '',
  currentUser: null,
  setupAllowed: false,
  drawerWallet: ''
};

const allowedPages = ['home', 'profile', 'profiles', 'properties', 'transfers', 'ledger', 'verify', 'system'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function shortAddress(value) {
  if (!value) return '--';
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
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
  if (!text || text === '--') return 'PC';
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

  return { wallet, ownedNfts, history, totalWei };
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

  const { wallet, ownedNfts, history, totalWei } = getProfileData();
  const displayName = state.currentUser?.displayName || state.currentUser?.username || 'Wallet holder';

  $('#profileAvatar').textContent = walletInitials(wallet);
  $('#profileGreeting').textContent = wallet ? `Hi, ${shortAddress(wallet)}` : `Hi, ${displayName}`;
  $('#profileWalletLine').textContent = wallet
    ? `${displayName} · ${wallet}`
    : 'Kết nối MetaMask để xem NFT, token và lịch sử giao dịch của ví.';
  $('#profileOwnedCount').textContent = ownedNfts.length;
  $('#profileTokenCount').textContent = ownedNfts.filter((item) => item.certificate_token_id !== null && item.certificate_token_id !== undefined).length;
  $('#profileHistoryCount').textContent = history.length;
  $('#profileTotalValue').textContent = formatWei(totalWei.toString());

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
  const { ownedNfts, history, totalWei } = getProfileData(wallet);
  const title = wallet ? `Hi, ${shortAddress(wallet)}` : 'Hi, wallet holder';

  $('#drawerAvatar').textContent = walletInitials(wallet);
  $('#drawerTitle').textContent = title;
  $('#drawerWallet').textContent = wallet ? `${profileNameForWallet(wallet)} · ${wallet}` : 'Kết nối ví để xem profile';
  $('#drawerOwnedCount').textContent = ownedNfts.length;
  $('#drawerTotalValue').textContent = formatWei(totalWei.toString());

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

  const items = state.ledgerOwnership.length ? state.ledgerOwnership : state.properties.map((item) => ({
    property_id: item.id,
    certificate_token_id: item.certificate_token_id,
    sc_property_id: item.sc_property_id,
    location: item.location,
    certificate_uri: item.certificate_uri,
    owner_full_name: item.owner_full_name,
    owner_wallet_address: item.owner_wallet_address,
    first_image_gateway_url: item.first_image_gateway_url
  }));

  if (!items.length) {
    grid.innerHTML = `
      <div class="profile-empty">
        <strong>Chưa có NFT certificate</strong>
        <small>Khi tài sản được tạo/mint, NFT có hình ảnh IPFS sẽ hiển thị ở trang chủ.</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map((item) => `
    <article class="market-nft-card">
      ${nftImageMarkup(item, 'market-nft-media', 'Property NFT')}
      <div class="market-nft-body">
        <strong>${escapeHtml(item.location || 'Property certificate')}</strong>
        <small>tokenId: #${escapeHtml(item.certificate_token_id ?? '--')} · propertyId: ${escapeHtml(item.sc_property_id ?? '--')}</small>
        <small>${escapeHtml(item.certificate_uri || 'Chưa có tokenURI')}</small>
        <div class="market-nft-owner">
          <small>Owner: ${escapeHtml(item.owner_full_name || shortAddress(item.owner_wallet_address))}</small>
          <button class="text-button" type="button" data-open-wallet="${escapeHtml(item.owner_wallet_address || '')}">Profile</button>
        </div>
      </div>
    </article>
  `).join('');
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
  showToast('WalletConnect cần Project ID riêng. Bản demo hiện dùng MetaMask/injected wallet.');
}

function logout() {
  state.token = '';
  state.currentUser = null;
  localStorage.removeItem('propertyChainToken');
  renderSession();
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

  const hasAll = Boolean(addresses.nft && addresses.registry && addresses.escrow);
  $('#chainStatus').textContent = hasAll ? `Chain ${state.contracts.chainId || '--'}` : 'Thiếu address';
  setDot('#chainDot', hasAll ? 'ok' : 'warn');
}

function renderMetrics() {
  $('#profileCount').textContent = state.profiles.length;
  $('#propertyCount').textContent = state.properties.length;
  $('#transferCount').textContent = state.transfers.length;
  $('#accountShort').textContent = shortAddress(state.account);
  $('#networkLabel').textContent = state.chainId ? `Chain ${Number(state.chainId)}` : 'Chưa có network';
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
          <small>${shortAddress(item.wallet_address)} | verified: ${item.verified}</small>
          <small>${item.backend_person_id}</small>
        </article>
      `;
    }

    if (state.activeTable === 'properties') {
      return `
        <article class="data-item">
          <strong>#${item.id} - ${item.location || 'No location'}</strong>
          <small>owner: ${item.owner_full_name || shortAddress(item.owner_wallet_address)}</small>
          <small>SC propertyId: ${item.sc_property_id ?? '--'} | tokenId: ${item.certificate_token_id ?? '--'}</small>
        </article>
      `;
    }

    return `
      <article class="data-item">
        <strong>#${item.id} - ${item.status}</strong>
        <small>${item.seller_full_name || shortAddress(item.seller_wallet_address)} -> ${item.buyer_full_name || shortAddress(item.buyer_wallet_address)}</small>
        <small>saleId: ${item.sc_sale_id ?? '--'} | priceWei: ${item.price_wei}</small>
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
          <small>Trạng thái: ${formatStatus(item.status)} | Giá Wei: ${item.price_wei}</small>
          <small>propertyId: ${item.sc_property_id ?? '--'} | tokenId: ${item.certificate_token_id ?? '--'} | saleId: ${item.sc_sale_id ?? '--'}</small>
          <small>Release tx: ${txLink(item.release_tx_hash)} | Deposit tx: ${txLink(item.deposit_tx_hash)}</small>
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
    list.innerHTML = '<div class="data-item"><strong>Chưa có NFT sở hữu</strong><small>Mint tài sản lên on-chain để danh sách sở hữu xuất hiện.</small></div>';
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
          <small>Owner verified: ${item.owner_verified} | trạng thái tài sản: ${item.active ? 'active' : 'inactive'}</small>
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


function renderUsers() {
  const list = $('#userList');

  if (!list) return;

  if (!state.appUsers.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có danh sách user</strong><small>Bấm Tải user để xem tài khoản hệ thống.</small></div>';
    return;
  }

  list.innerHTML = state.appUsers.map((user) => `
    <article class="data-item">
      <strong>#${user.id} - ${user.displayName || user.username}</strong>
      <small>${shortAddress(user.walletAddress)} | vai trò: ${formatRole(user.role)} | hoạt động: ${user.active}</small>
      <small>profileId: ${user.profileId ?? '--'}</small>
    </article>
  `).join('');
}

async function loadUsers() {
  if (state.currentUser?.role !== 'admin') {
    state.appUsers = [];
    renderUsers();
    return;
  }

  const payload = await api('/api/auth/users');
  state.appUsers = payload.data || [];
  renderUsers();
  logAction('Đã tải danh sách tài khoản', `${state.appUsers.length} tài khoản`);
}

async function createAppUser() {
  const body = collectForm('#userAccountForm');

  if (!body.profile_id) {
    delete body.profile_id;
  }

  if (!body.wallet_address) {
    throw new Error('Hãy nhập địa chỉ ví đăng nhập cho tài khoản này');
  }

  const payload = await api('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  logAction('Đã tạo tài khoản', `${payload.data.username} (${formatRole(payload.data.role)})`);
  showToast('Tài khoản mới đã được tạo');
  await loadUsers();
}

async function loadData() {
  const [profiles, properties, transfers] = await Promise.all([
    api('/api/profiles'),
    api('/api/properties'),
    api('/api/transfers')
  ]);

  state.profiles = profiles.data || [];
  state.properties = properties.data || [];
  state.transfers = transfers.data || [];
  renderMetrics();
  renderDataList();
  renderProfilePage();
  renderHomeNfts();
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

  try {
    await loadUsers();
  } catch (error) {
    ok = false;
    logAction('Chưa tải được danh sách tài khoản', error.message);
  }

  showToast(ok ? 'Đã làm mới dashboard' : 'Một phần hệ thống chưa sẵn sàng');
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

async function createProfile() {
  const body = collectForm('#profileForm');
  const payload = await api('/api/profiles', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  logAction('Đã lưu hồ sơ cá nhân', `id: ${payload.data.id}`);
  showToast('Hồ sơ cá nhân đã được lưu');
  await loadData();
}

async function registerPersonOnChain() {
  const body = collectForm('#profileForm');
  const payload = await api('/api/blockchain/registry/register-person', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  logAction('Đã ghi person on-chain', payload.data.txHash || '');
  showToast('Transaction register person đã hoàn tất');
}


function renderPropertyImages() {
  const list = $('#propertyImageList');

  if (!list) return;

  if (!state.propertyImages.length) {
    list.innerHTML = '<div class="data-item"><strong>Chưa có ảnh IPFS</strong><small>Upload ảnh tài sản để tạo metadata NFT.</small></div>';
    return;
  }

  list.innerHTML = state.propertyImages.map((image) => `
    <article class="image-card">
      <img src="${image.gateway_url}" alt="${image.caption || image.original_name || 'Property image'}" loading="lazy" />
      <div>
        <strong>${image.caption || image.original_name || 'Property image'}</strong>
        <small>${image.image_uri}</small>
      </div>
    </article>
  `).join('');
}

async function checkIpfsStatus() {
  const payload = await api('/api/ipfs/status');
  const config = payload.data;
  logAction('IPFS status', `Pinata: ${config.pinataConfigured ? 'configured' : 'missing'} | Gateway: ${config.gateway}`);
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
  const file = form.elements.image.files[0];

  if (!file) {
    throw new Error('Hãy chọn ảnh tài sản trước khi upload');
  }

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
  showToast('Metadata NFT đã được tạo, certificate_uri đã được cập nhật');
  await loadData();
}

async function createProperty() {
  const body = collectForm('#propertyForm');
  const payload = await api('/api/properties', {
    method: 'POST',
    body: JSON.stringify({ ...body, active: true })
  });

  logAction('Đã lưu hồ sơ tài sản', `id: ${payload.data.id}`);
  showToast('Hồ sơ tài sản đã được lưu');
  await loadData();
}

async function registerPropertyOnChain() {
  const body = collectForm('#propertyForm');
  const ownerProfile = state.profiles.find((profile) => String(profile.id) === String(body.owner_profile_id));

  if (!ownerProfile) {
    throw new Error('Không tìm thấy owner_profile_id trong danh sách profiles. Hãy bấm Tải dữ liệu trước.');
  }

  const payload = await api('/api/blockchain/registry/register-property', {
    method: 'POST',
    body: JSON.stringify({
      backend_property_id: body.backend_property_id,
      initial_owner: ownerProfile.wallet_address,
      property_data_hash: body.property_data_hash,
      legal_document_hash: body.legal_document_hash,
      location: body.location,
      certificate_uri: body.certificate_uri
    })
  });

  const txHash = payload.data.txHash || '';
  $('#propertyChainForm [name="registry_tx_hash"]').value = txHash;
  logAction('Đã mint NFT certificate', txHash);
  showToast('Property đã được register on-chain');
}

async function patchPropertyChain() {
  const body = collectForm('#propertyChainForm');
  const propertyDbId = body.property_db_id;
  delete body.property_db_id;

  const payload = await api(`/api/properties/${propertyDbId}/blockchain`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });

  logAction('Đã cập nhật mã on-chain của tài sản', `id: ${payload.data.id}`);
  showToast('Đã lưu mã on-chain và tokenId');
  await loadData();
}

async function createTransfer() {
  const body = collectForm('#transferForm');
  const payload = await api('/api/transfers', {
    method: 'POST',
    body: JSON.stringify({
      backend_transaction_id: body.backend_transaction_id,
      backend_transaction_hash: body.backend_transaction_hash,
      property_id: body.property_id,
      buyer_profile_id: body.buyer_profile_id,
      price_wei: body.price_wei,
      document_hash: body.document_hash
    })
  });

  logAction('Đã tạo hồ sơ giao dịch', `id: ${payload.data.id}`);
  showToast('Hồ sơ giao dịch đã được lưu');
  await loadData();
}

async function createSaleOnChain() {
  const body = collectForm('#transferForm');
  const escrow = await getEscrowContract();
  const tx = await escrow.createCertificateSale(
    body.sc_property_id,
    requireAddress(body.buyer_wallet_address, 'buyer_wallet_address'),
    body.price_wei,
    toBytes32(body.backend_transaction_id),
    toBytes32(body.document_hash)
  );

  logAction('Đã gửi createCertificateSale', tx.hash);
  const receipt = await tx.wait();
  logAction('Sale đã được tạo on-chain', `block ${receipt.blockNumber}`);
  showToast('Sale on-chain đã hoàn tất');
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
  const escrow = await getEscrowContract();
  const tx = await escrow.depositCertificate(body.sale_id);

  logAction('Đã gửi deposit NFT', tx.hash);
  const receipt = await tx.wait();
  $('#releaseForm [name="tx_hash"]').value = tx.hash;
  logAction('Deposit NFT hoàn tất', `block ${receipt.blockNumber}`);
  showToast('NFT đã vào Escrow');
}

async function markDepositSql() {
  const body = collectForm('#releaseForm');
  const payload = await api(`/api/transfers/${body.transfer_db_id}/deposit`, {
    method: 'PATCH',
    body: JSON.stringify({ deposit_tx_hash: body.tx_hash })
  });

  logAction('Giao dịch đã được đánh dấu ký gửi', `id: ${payload.data.id}`);
  showToast('Đã cập nhật trạng thái ký gửi');
  await loadData();
}

async function releaseByBackend() {
  const body = collectForm('#releaseForm');
  const release = await api('/api/blockchain/escrow/release', {
    method: 'POST',
    body: JSON.stringify({ sale_id: body.sale_id })
  });

  const txHash = release.data.txHash || body.tx_hash;
  $('#releaseForm [name="tx_hash"]').value = txHash || '';
  logAction('Dịch vụ đã xác nhận chuyển NFT', txHash || '');

  if (body.transfer_db_id) {
    await api(`/api/transfers/${body.transfer_db_id}/release`, {
      method: 'PATCH',
      body: JSON.stringify({ release_tx_hash: txHash })
    });
    logAction('Giao dịch đã hoàn tất', `id: ${body.transfer_db_id}`);
  }

  showToast('Release hoàn tất');
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

function bindActions() {
  $('#loginBtn').addEventListener('click', () => run(login));
  $('#walletConnectLoginBtn').addEventListener('click', showWalletConnectInfo);
  $('#setupAdminBtn').addEventListener('click', () => run(setupAdmin));
  $('#logoutBtn').addEventListener('click', logout);
  $('#viewProfileBtn').addEventListener('click', () => toggleProfileDrawer());
  $('#profileDrawerBtn').addEventListener('click', () => toggleProfileDrawer());
  $('#profileDrawerCloseBtn').addEventListener('click', closeProfileDrawer);
  $('#profileDrawerBackdrop').addEventListener('click', closeProfileDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProfileDrawer();
  });
  $('#profileRefreshBtn').addEventListener('click', () => run(refreshAll));
  $('#refreshNftMarketBtn').addEventListener('click', () => run(refreshAll));
  $$('[data-profile-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(`#${button.dataset.profileTarget}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('#authApiBaseInput').addEventListener('change', (event) => {
    setApiBase(event.target.value);
    run(loadSetupStatus);
  });

  $('#globalSearchInput').addEventListener('input', renderSearchResults);
  $('#globalSearchInput').addEventListener('focus', renderSearchResults);

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
  $('#apiBaseInput').addEventListener('change', (event) => {
    setApiBase(event.target.value);
  });

  $('#connectWalletBtn').addEventListener('click', () => run(connectWallet));
  $('#refreshAllBtn').addEventListener('click', () => run(refreshAll));
  $('#loadUsersBtn').addEventListener('click', () => run(loadUsers));
  $('#createUserBtn').addEventListener('click', () => run(createAppUser));
  $('#checkSystemBtn').addEventListener('click', () => run(refreshAll));
  $('#loadDataBtn').addEventListener('click', () => run(loadData));
  $('#loadLedgerBtn').addEventListener('click', () => run(loadLedgerData));
  $('#checkIpfsBtn').addEventListener('click', () => run(checkIpfsStatus));
  $('#loadPropertyImagesBtn').addEventListener('click', () => run(loadPropertyImages));
  $('#uploadPropertyImageBtn').addEventListener('click', () => run(uploadPropertyImage));
  $('#createMetadataBtn').addEventListener('click', () => run(createPropertyMetadata));
  $('#createProfileBtn').addEventListener('click', () => run(createProfile));
  $('#registerPersonChainBtn').addEventListener('click', () => run(registerPersonOnChain));
  $('#createPropertyBtn').addEventListener('click', () => run(createProperty));
  $('#registerPropertyChainBtn').addEventListener('click', () => run(registerPropertyOnChain));
  $('#patchPropertyChainBtn').addEventListener('click', () => run(patchPropertyChain));
  $('#createTransferBtn').addEventListener('click', () => run(createTransfer));
  $('#createSaleChainBtn').addEventListener('click', () => run(createSaleOnChain));
  $('#approveNftBtn').addEventListener('click', () => run(approveNft));
  $('#depositNftBtn').addEventListener('click', () => run(depositNft));
  $('#markDepositSqlBtn').addEventListener('click', () => run(markDepositSql));
  $('#releaseBackendBtn').addEventListener('click', () => run(releaseByBackend));
  $('#verifyOwnershipBtn').addEventListener('click', () => run(verifyOwnership));
  $('#checkNftBtn').addEventListener('click', () => run(checkNft));
  $('#clearLogBtn').addEventListener('click', () => {
    $('#activityLog').innerHTML = '';
  });

  $$('[data-fill-wallet]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(`#${button.dataset.fillWallet}`);
      target.value = state.account || '';
      showToast(state.account ? 'Đã điền ví hiện tại' : 'Chưa kết nối MetaMask');
    });
  });

  document.addEventListener('click', (event) => {
    const walletButton = event.target.closest('[data-open-wallet], [data-search-wallet]');
    if (walletButton) {
      const wallet = walletButton.dataset.openWallet || walletButton.dataset.searchWallet || '';
      if (wallet) {
        openProfileDrawer(wallet);
        $('#searchResults').hidden = true;
      }
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
  renderProfileDrawer();
  closeProfileDrawer();
  logAction('Frontend sẵn sàng', state.apiBase);
  run(restoreSession);
}

document.addEventListener('DOMContentLoaded', init);
