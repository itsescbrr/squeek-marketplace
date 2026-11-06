// Squeek Market — data access layer (multi-collection).
// Chain state is authoritative for trades. Metadata is read per collection:
// collections with a project indexer (`api`) use it; every other collection
// falls back to on-chain `tokenURI`.
// Only collections allowlisted on-chain can actually be listed; the frontend
// directory mirrors CONFIG.COLLECTIONS.

let readProvider = null;
let walletProvider = null;
let signer = null;
let signerAddr = null;

const SQ = () => CONFIG.COLLECTIONS[0].address; // legacy default (Squeek)

function collectionMeta(addr) {
  const a = String(addr || '').toLowerCase();
  return (CONFIG.COLLECTIONS || []).find((c) => c.address.toLowerCase() === a) || null;
}
function collectionName(addr) {
  const c = collectionMeta(addr);
  return c ? c.name : (String(addr).slice(0, 6) + '...' + String(addr).slice(-4));
}
function collectionSlug(nft) {
  const c = collectionMeta(nft);
  return (c && c.slug) ? c.slug : String(nft || '').toLowerCase();
}
function collectionBySlug(slugOrAddr) {
  const s = String(slugOrAddr || '');
  if (s.startsWith('0x')) return s; // already an address
  const c = (CONFIG.COLLECTIONS || []).find((x) => x.slug && x.slug.toLowerCase() === s.toLowerCase());
  return c ? c.address : null;
}

function getReadProvider() {
  if (!readProvider) readProvider = new ethers.JsonRpcProvider(CONFIG.RPC, CONFIG.CHAIN_ID);
  return readProvider;
}
function nftRead(nft) { return new ethers.Contract(nft || SQ(), NFT_ABI, getReadProvider()); }
function marketRead() { return new ethers.Contract(CONFIG.MARKET, MARKET_ABI, getReadProvider()); }
function nftWrite(nft) { if (!signer) throw new Error('Wallet not connected'); return new ethers.Contract(nft || SQ(), NFT_ABI, signer); }
function marketWrite() { if (!signer) throw new Error('Wallet not connected'); return new ethers.Contract(CONFIG.MARKET, MARKET_ABI, signer); }

// ---------- wallet ----------
const _walletProviders = new Map();
let _activeWallet = null; // EIP-1193 provider currently in use (for events/signing)

function hasWallet() { return typeof window.ethereum !== 'undefined' || _walletProviders.size > 0; }

// EIP-6963 multi-wallet discovery: modern wallets announce themselves, so the user
// can pick MetaMask vs Rabby etc. instead of always using window.ethereum.
function initWalletProviders(onChange) {
  const announce = (ev) => {
    const d = ev.detail || {};
    const info = d.info, provider = d.provider;
    if (!info || !provider || typeof provider.request !== 'function') return;
    const key = String(info.uuid || info.rdns || info.name || Math.random());
    _walletProviders.set(key, { info, provider });
    if (typeof onChange === 'function') onChange();
  };
  window.addEventListener('eip6963:announceProvider', announce);
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (_) {}
}
function walletProviders() { return [..._walletProviders.values()]; }

// Resolve the EIP-1193 provider for a chosen wallet entry (or the default injected one).
function walletEthereum(pInfo) {
  if (pInfo && pInfo.provider && typeof pInfo.provider.request === 'function') return pInfo.provider;
  return (typeof window.ethereum !== 'undefined') ? window.ethereum : null;
}

// Wait for the wallet to settle an accountsChanged event (used to ride out
// Blockaid's first-request rejection, where the wallet still shows its connect
// dialog after rejecting the initial eth_requestAccounts).
function waitForAccounts(ethereum, ms) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const onChange = (accs) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ethereum.removeListener('accountsChanged', onChange); } catch (_) {}
      resolve(Array.isArray(accs) && accs.length ? accs : null);
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ethereum.removeListener('accountsChanged', onChange); } catch (_) {}
      resolve(null);
    }, ms);
    try { ethereum.on('accountsChanged', onChange); } catch (_) { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } }
  });
}

async function connectWallet(pInfo) {
  const ethereum = walletEthereum(pInfo);
  if (!ethereum || typeof ethereum.request !== 'function') throw new Error('No wallet detected. Install MetaMask or Rabby.');
  let accounts = null;
  try {
    accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  } catch (e) {
    // Blockaid (flagged site) or wallet UX can reject the first attempt while
    // the connect dialog is still open — wait for the follow-up accountsChanged.
    accounts = await waitForAccounts(ethereum, 12000);
    if (!accounts) throw e;
  }
  if (!accounts || !accounts.length) throw new Error('No account selected.');
  let provider = new ethers.BrowserProvider(ethereum);
  let net = await provider.getNetwork();
  if (Number(net.chainId) !== CONFIG.CHAIN_ID) {
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CONFIG.CHAIN_HEX }] });
    } catch (e) {
      if (e && e.code === 4902) {
        await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CONFIG.CHAIN_HEX, chainName: CONFIG.CHAIN_NAME, rpcUrls: [CONFIG.RPC], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 } }] });
      } else { throw new Error('Switch your wallet to ' + CONFIG.CHAIN_NAME + '.'); }
    }
    provider = new ethers.BrowserProvider(ethereum);
  }
  walletProvider = provider;
  _activeWallet = ethereum;
  signer = new ethers.JsonRpcSigner(provider, accounts[0]);
  signerAddr = accounts[0];
  return signerAddr;
}

function disconnectWallet() { signer = null; signerAddr = null; walletProvider = null; _activeWallet = null; }

// Silently restore an already-authorised wallet on page load (no eth_requestAccounts
// prompt). Respects an explicit user disconnect so a different wallet can be chosen.
async function restoreWallet() {
  if (!hasWallet()) return null;
  let dis = false;
  try { dis = localStorage.getItem('sq_disconnected') === '1'; } catch (_) {}
  if (dis) return null;
  const ethereum = walletEthereum(null);
  if (!ethereum) return null;
  try {
    const accounts = await ethereum.request({ method: 'eth_accounts' });
    if (!accounts || !accounts.length) return null;
    const provider = new ethers.BrowserProvider(ethereum);
    walletProvider = provider;
    _activeWallet = ethereum;
    signer = new ethers.JsonRpcSigner(provider, accounts[0]);
    signerAddr = accounts[0];
    return signerAddr;
  } catch (e) { return null; }
}

// ---------- metadata ----------
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeTokenURI(uri) {
  if (!uri) return null;
  if (uri.startsWith('data:application/json;base64,')) {
    try { return JSON.parse(b64decode(uri.slice('data:application/json;base64,'.length))); }
    catch (e) { return null; }
  }
  if (uri.startsWith('data:application/json,')) {
    try { return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length))); }
    catch (e) { return null; }
  }
  return { _externalUri: uri };
}

async function fetchExternalJson(uri) {
  let url = uri;
  if (uri.startsWith('ipfs://')) {
    url = 'https://ipfs.filebase.io/ipfs/' + uri.slice('ipfs://'.length);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + res.status);
  return res.json();
}

function normalizeMeta(j, nftName, tokenId) {
  return {
    name: (j && j.name) || (nftName + ' #' + tokenId),
    image: (j && j.image) || '',
    attrs: ((j && j.attributes) || []).map((a) => ({ trait_type: a.trait_type || a.traitType, value: a.value })),
    description: (j && j.description) || '',
    owner: null,
  };
}

async function metadataFromChain(nft, tokenId) {
  const name = collectionName(nft);
  try {
    const uri = await nftRead(nft).tokenURI(tokenId);
    let j = decodeTokenURI(uri);
    if (j && j._externalUri) {
      try { j = await fetchExternalJson(j._externalUri); }
      catch (e) { return normalizeMeta(null, name, tokenId); }
    }
    if (!j) return normalizeMeta(null, name, tokenId);
    return normalizeMeta(j, name, tokenId);
  } catch (e) {
    return normalizeMeta(null, name, tokenId);
  }
}

// Squeek-style project API: GET {api}/v1/squeeks/{id} -> { metadata, custody }
async function fetchFromProjectApi(nft, tokenId) {
  const c = collectionMeta(nft);
  if (!c || !c.api) throw new Error('no api');
  const res = await fetch(c.api + '/v1/squeeks/' + tokenId);
  if (!res.ok) throw new Error('API ' + res.status);
  const j = await res.json();
  if (!j) throw new Error('empty');
  const m = j.metadata || {};
  return {
    name: m.name || (c.name + ' #' + tokenId),
    image: m.imageDataUri || m.image || '',
    attrs: (m.attributes || []).map((a) => ({ trait_type: a.traitType || a.trait_type, value: a.value })),
    owner: (j.custody && j.custody.owner) || null,
    description: m.description || '',
  };
}

const _metaCache = new Map();
async function metadataFromChainCached(nft, tokenId) {
  const key = String(nft).toLowerCase() + ':' + tokenId;
  if (_metaCache.has(key)) return _metaCache.get(key);
  const m = await metadataFromChain(nft, tokenId);
  _metaCache.set(key, m);
  return m;
}

async function fetchMetadata(nft, tokenId) {
  const c = collectionMeta(nft);
  // On-chain tokenURI is authoritative and fast (Squeek bakes its art on-chain as
  // inline base64 SVG), so resolve it first and keep the slower project API as a
  // fallback only. This keeps collection grids and covers rendering quickly.
  try {
    const [meta, owner] = await Promise.all([
      metadataFromChainCached(nft, tokenId),
      nftRead(nft).ownerOf(tokenId).catch(() => null),
    ]);
    meta.owner = owner;
    return meta;
  } catch (e) { /* on-chain unavailable, fall through */ }
  if (c && c.api) {
    try { return await fetchFromProjectApi(nft, tokenId); }
    catch (e2) { /* fall through */ }
  }
  return { name: collectionName(nft) + ' #' + tokenId, image: '', attrs: null, owner: null, error: true };
}

// Highest id a collection mints (Squeek launched ids 1..8888; merges burn some,
// leaving gaps, so totalSupply() is the live count, not the max id).
function collectionMaxId(nft) {
  const c = collectionMeta(nft);
  return (c && c.maxTokenId != null) ? c.maxTokenId : null;
}

// Enumerate live (non-burned) tokens descending from `startId`. Burned ids revert
// on tokenURI/ownerOf (empty image), so we skip them and keep scanning. Batched +
// parallel so the grid renders fast instead of one RPC round-trip per token.
async function fetchValidTokens(nft, startId, count) {
  const rows = [];
  let cursor = startId;
  while (rows.length < count && cursor >= 1) {
    const batch = (count - rows.length) + 8;
    const ids = [];
    for (let i = cursor; i >= 1 && ids.length < batch; i--) ids.push(i);
    if (!ids.length) break;
    const results = await Promise.all(ids.map(async (id) => {
      const meta = await fetchMetadata(nft, id);
      return (meta && meta.image) ? { id, meta, owner: meta.owner } : null;
    }));
    for (const r of results) { if (r) rows.push(r); }
    cursor = ids[ids.length - 1] - 1;
  }
  return { rows: rows.slice(0, count), nextStart: cursor < 1 ? 0 : cursor };
}

// ---------- listings / offers ----------
async function fetchListings(nft) {
  const m = marketRead();
  const [rawNfts, rawTokenIds] = await m.listedKeys();
  const nfts = Array.from(rawNfts || []);
  const tokenIds = Array.from(rawTokenIds || []);
  if (nfts.length === 0) return [];
  const [prices, sellers, active] = await m.getListings(nfts, tokenIds);
  const out = [];
  for (let i = 0; i < nfts.length; i++) {
    if (!active[i]) continue;
    if (nft && nfts[i].toLowerCase() !== String(nft).toLowerCase()) continue;
    out.push({ nft: nfts[i], tokenId: Number(tokenIds[i]), price: prices[i], seller: sellers[i] });
  }
  return out;
}
async function fetchListing(nft, tokenId) { return marketRead().getListing(nft, tokenId); }
async function fetchOffer(nft, tokenId) { return marketRead().getOffer(nft, tokenId); }
async function fetchRoyalty(nft, tokenId, price) {
  try {
    const [receiver, amount] = await nftRead(nft).royaltyInfo(tokenId, price);
    return { receiver, amount };
  } catch (e) { return { receiver: ethers.ZeroAddress, amount: 0n }; }
}

// ---------- collection stats ----------
const _statsCache = new Map();
async function fetchCollectionStats(nft) {
  const key = String(nft).toLowerCase();
  const hit = _statsCache.get(key);
  if (hit && (Date.now() - hit.at) < 15000) return hit.stats;
  const n = nftRead(nft), m = marketRead();
  const supply = Number(await n.totalSupply());
  const listingRows = await fetchListings(nft);
  const listed = listingRows.length;
  let floor = null;
  for (const r of listingRows) { if (floor === null || r.price < floor) floor = r.price; }
  let solds = [], accepted = [];
  try {
    [solds, accepted] = await Promise.all([
      m.queryFilter(m.filters.Sold(nft), CONFIG.MARKET_START_BLOCK).catch(() => []),
      m.queryFilter(m.filters.OfferAccepted(nft), CONFIG.MARKET_START_BLOCK).catch(() => []),
    ]);
  } catch (e) { /* no history available */ }
  const volume = [...solds, ...accepted].reduce((acc, e) => acc + (e.args && e.args.price ? e.args.price : 0n), 0n);
  let offers = 0, topOffer = null;
  try {
    const [made, canc, acc] = await Promise.all([
      m.queryFilter(m.filters.OfferMade(nft), CONFIG.MARKET_START_BLOCK).catch(() => []),
      m.queryFilter(m.filters.OfferCancelled(nft), CONFIG.MARKET_START_BLOCK).catch(() => []),
      m.queryFilter(m.filters.OfferAccepted(nft), CONFIG.MARKET_START_BLOCK).catch(() => []),
    ]);
    const key = (e) => String(e.args.tokenId) + ':' + String(e.args.offerer).toLowerCase();
    const closed = new Set([...canc, ...acc].map(key));
    const active = made.filter((e) => !closed.has(key(e)));
    offers = active.length;
    let top = null;
    for (const e of active) { if (top === null || e.args.price > top) top = e.args.price; }
    topOffer = top;
  } catch (e) { /* offers unavailable */ }
  const result = { supply, listed, floor, volume, offers, topOffer, listedRows: listingRows };
  _statsCache.set(key, { stats: result, at: Date.now() });
  return result;
}

// ---------- ownership ----------
async function fetchOwnedTokens(nft, addr) {
  const c = collectionMeta(nft);
  if (c && c.api) {
    try {
      const res = await fetch(c.api + '/v1/accounts/' + addr);
      if (res.ok) {
        const a = await res.json();
        if (a && Array.isArray(a.tokens)) {
          const owned = a.tokens.filter((t) => t.custody === 'wallet').map((t) => Number(t.tokenId));
          owned.sort((x, y) => x - y);
          return owned;
        }
      }
    } catch (e) { /* fall through */ }
  }
  const n = nftRead(nft);
  const [fromSent, toReceived] = await Promise.all([
    n.queryFilter(n.filters.Transfer(addr, null), CONFIG.MARKET_START_BLOCK).catch(() => []),
    n.queryFilter(n.filters.Transfer(null, addr), CONFIG.MARKET_START_BLOCK).catch(() => []),
  ]);
  const latest = new Map();
  const apply = (ev) => {
    const tid = Number(ev.args.tokenId);
    const cur = latest.get(tid);
    if (!cur || ev.blockNumber > cur.block || (ev.blockNumber === cur.block && ev.logIndex > cur.log)) {
      latest.set(tid, { to: ev.args.to, block: ev.blockNumber, log: ev.logIndex });
    }
  };
  [...fromSent, ...toReceived].forEach(apply);
  const owned = [];
  for (const [tid, info] of latest) if (info.to.toLowerCase() === addr.toLowerCase()) owned.push(tid);
  owned.sort((a, b) => a - b);
  return owned;
}

// ---------- activity / history ----------
async function fetchMarketEvents(nft) {
  const m = marketRead();
  const names = ['Listed', 'Sold', 'Cancelled', 'OfferMade', 'OfferCancelled', 'OfferAccepted'];
  const all = await Promise.all(names.map((n) => {
    const filt = nft ? m.filters[n](nft) : m.filters[n]();
    return m.queryFilter(filt, CONFIG.MARKET_START_BLOCK).catch(() => []);
  }));
  const evs = all.flat().sort((a, b) => (b.blockNumber - a.blockNumber) || (b.logIndex - a.logIndex));
  return evs;
}

// contract deployer (creator) via Blockscout
const _creatorCache = new Map();
async function fetchContractCreator(addr) {
  const key = String(addr).toLowerCase();
  if (_creatorCache.has(key)) return _creatorCache.get(key);
  let result = null;
  try {
    const r = await fetch(CONFIG.BLOCK_SCOUT_API + '/addresses/' + addr);
    if (r.ok) {
      const j = await r.json();
      result = j.creator_address_hash || j.creator_hash || null;
    }
  } catch (e) { result = null; }
  _creatorCache.set(key, result);
  return result;
}