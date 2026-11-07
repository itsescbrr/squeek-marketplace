// Squeek Market — UI, routing, and actions (multi-collection).
// The marketplace is curated: the Explore directory mirrors CONFIG.COLLECTIONS,
// and only those collections (which are also allowlisted on-chain) can be traded.

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeImage(src) {
  if (!src) return '';
  if (src.startsWith('data:image/') || src.startsWith('https://') || src.startsWith('http://')) return String(src);
  return '';
}
function fmtAddr(a) { if (!a) return ''; const s = String(a); return s.slice(0, 6) + '…' + s.slice(-4); }
function fmtEth(wei) { try { return (+ethers.formatEther(wei)).toFixed(4); } catch { return '0.0000'; } }
function fmtWei(wei) { try { const s = Number(ethers.formatEther(wei)).toFixed(6); return s.replace(/0+$/, '').replace(/\.$/, ''); } catch { return String(wei); } }
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function statCount(n) { return (n > 0 ? String(n) : '-'); }
function statHtml(label, value) { return '<div class="stat"><span class="stat-label">' + esc(label) + '</span><span class="stat-num">' + esc(value) + '</span></div>'; }
function txLink(h) { return ' · <a href="' + esc(CONFIG.EXPLORER_TX(h)) + '" target="_blank" rel="noopener">view tx</a>'; }
function addrLink(a, txt) { return '<a class="hl" href="#/profile/' + esc(a) + '">' + esc(txt || fmtAddr(a)) + '</a>'; }
function itemLabel(nft, tokenId) { return collectionName(nft) + ' #' + tokenId; }

const SQUEEK_OVERVIEW = "SqueekNFT tracks ownership for at most 9,999 Squeeks, stores each Squeek's level and next merge height, and returns metadata from the DotGrid renderer. It has no proxy or owner. Its constructor fixes the renderer, Genesis DotGrid page, collection seed, SqueekCore, admin Timelock, protocol recipient, collection URI, maximum level and cooldown table; the admin binds or replaces the launch until issuance starts. The bound launch distributes IDs 1 to 8,888, and SqueekStaking pays rewards for deposited Squeeks. Merges use only SqueekCore's completed Squeek block height.";

// deterministic blockies-style avatar from an address
function identiconHtml(addr, size) {
  size = size || 48;
  const s = String(addr || '').toLowerCase().replace(/^0x/, '') || '0';
  let seed = 2166136261;
  for (let i = 0; i < s.length; i++) { seed = ((seed ^ s.charCodeAt(i)) >>> 0); seed = (seed * 16777619) >>> 0; }
  let st = seed >>> 0;
  const rnd = () => { st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; };
  const hue = Math.floor(rnd() * 360);
  const cell = 'hsl(' + hue + ',58%,44%)';
  const bg = 'hsl(' + hue + ',45%,90%)';
  let rects = '';
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (rnd() > 0.5) {
        rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        const mx = 4 - x;
        if (mx !== x) rects += '<rect x="' + mx + '" y="' + y + '" width="1" height="1"/>';
      }
    }
  }
  return '<svg class="pfp" width="' + size + '" height="' + size + '" viewBox="0 0 5 5" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="5" height="5" fill="' + bg + '"/>' + rects.replace(/<rect /g, '<rect fill="' + cell + '" ') + '</svg>';
}
function eventInvolves(ev, addr) {
  if (!addr || !ev) return false;
  const a = ev.args || {}, al = addr.toLowerCase();
  return ['seller', 'buyer', 'offerer'].some((f) => a[f] && String(a[f]).toLowerCase() === al);
}

let collectionCursor = null;

/* ---------- toast ---------- */
let toastTimer = null;
function toast(html) {
  const t = $('toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}

/* ---------- states ---------- */
function loadingHtml(msg) { return '<div class="loading"><span class="spin"></span>' + esc(msg || 'Loading…') + '</div>'; }
function errorHtml(e) { return '<div class="empty state">Something went wrong: ' + esc((e && (e.shortMessage || e.message)) || e) + '</div>'; }
function emptyHtml(msg) { return '<div class="empty state">' + esc(msg) + '</div>'; }

/* ---------- wallet ---------- */
async function connect() {
  try {
    const provs = walletProviders();
    let picked = null;
    if (provs.length > 1) {
      picked = await pickWallet(provs);
      if (!picked) return;
    } else if (provs.length === 1) {
      picked = provs[0];
    }
    await connectWallet(picked || null);
    try { localStorage.removeItem('sq_disconnected'); } catch (_) {}
    renderWallet();
    toast('Wallet connected.');
    router();
  } catch (e) {
    toast('Connect failed: ' + esc(e.shortMessage || e.message));
  }
}
function disconnect() {
  disconnectWallet();
  try { localStorage.setItem('sq_disconnected', '1'); } catch (_) {}
  renderWallet();
  router();
}
function pickWallet(provs) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'wallet-modal-overlay';
    const opts = provs.map((p, i) => {
      const icon = (p.info && p.info.icon) ? '<img src="' + esc(p.info.icon) + '" alt="" />' : '';
      return '<button type="button" class="wallet-option" data-idx="' + i + '">' + icon + '<span>' + esc(p.info.name || 'Wallet') + '</span></button>';
    }).join('');
    overlay.innerHTML = '<div class="wallet-modal"><h3>Choose a wallet</h3><p class="muted">Connect one of your installed wallets.</p>' + opts + '<button type="button" class="wallet-cancel">Cancel</button></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); resolve(null); } });
    overlay.querySelectorAll('.wallet-option').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.idx);
      close();
      resolve(provs[i] || null);
    }));
    const cancelBtn = overlay.querySelector('.wallet-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { close(); resolve(null); });
  });
}
function renderWallet() {
  const btn = $('connect-btn');
  const addrBtn = $('addr');
  const badge = $('net-badge');
  if (signerAddr) {
    btn.textContent = 'Disconnect';
    btn.onclick = disconnect;
    addrBtn.hidden = false;
    addrBtn.innerHTML = identiconHtml(signerAddr, 26) + '<span>' + fmtAddr(signerAddr) + '</span>';
    addrBtn.title = signerAddr;
    addrBtn.onclick = () => { location.hash = '#/profile/' + signerAddr; };
    badge.hidden = false;
    badge.textContent = CONFIG.CHAIN_NAME;
    badge.classList.remove('warn');
  } else {
    btn.textContent = 'Connect wallet';
    btn.onclick = connect;
    addrBtn.hidden = true;
    badge.hidden = true;
  }
}

/* ---------- routing ---------- */
function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'explore') return { name: 'explore' };
  if (parts[0] === 'collection') return { name: 'collection', nft: collectionBySlug(parts[1]) || parts[1] || SQ() };
  if (parts[0] === 'nft') {
    if (parts.length >= 3) return { name: 'nft', nft: collectionBySlug(parts[1]) || parts[1], id: parts[2] };
    return { name: 'nft', nft: SQ(), id: parts[1] };
  }
  if (parts[0] === 'profile') return { name: 'profile', addr: parts[1] || signerAddr || null };
  return { name: 'explore' };
}
function highlightNav(name) {
  const map = { explore: 'explore', collection: 'explore', nft: 'explore', profile: '' };
  const key = map[name] !== undefined ? map[name] : 'explore';
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('is-active', a.dataset.route === key));
}
async function router() {
  const r = parseRoute();
  highlightNav(r.name);
  const view = $('view');
  view.innerHTML = loadingHtml();
  try {
    if (r.name === 'explore') await renderExplore(view);
    else if (r.name === 'collection') await renderCollection(view, r.nft);
    else if (r.name === 'nft') await renderNft(view, r.nft, r.id);
    else if (r.name === 'profile') await renderProfile(view, r.addr);
    else view.innerHTML = errorHtml('Unknown route');
  } catch (e) {
    view.innerHTML = errorHtml(e);
  }
  window.scrollTo(0, 0);
}

/* ---------- shared builders ---------- */
function cardHtml(nft, tokenId, meta, opts = {}) {
  const img = safeImage(meta.image);
  const name = meta.name || itemLabel(nft, tokenId);
  const media = img ? '<img src="' + esc(img) + '" alt="' + esc(name) + '" loading="lazy" />' : '<span class="noimg">' + esc(name) + '</span>';
  const price = opts.price != null ? '<div class="card-price">' + esc(fmtEth(opts.price)) + ' <span class="unit">ETH</span></div>' : '';
  const owner = opts.owner ? '<div class="card-meta">' + esc(fmtAddr(opts.owner)) + '</div>' : '';
  return '<a class="card" href="#/nft/' + esc(collectionSlug(nft)) + '/' + esc(tokenId) + '">'
    + '<div class="card-media">' + media + '</div>'
    + '<div class="card-body">'
    + '<div class="card-name">' + esc(name) + '</div>'
    + '<div class="card-meta">#' + esc(tokenId) + '</div>'
    + owner + price
    + '</div></a>';
}

/* ---------- Explore ---------- */
async function renderExplore(view) {
  const cols = CONFIG.COLLECTIONS || [];
  const cards = await Promise.all(cols.map(async (c) => {
    const [stats, name] = await Promise.all([
      fetchCollectionStats(c.address),
      nftRead(c.address).name().catch(() => c.name),
    ]);
    const coverPage = await fetchValidTokens(c.address, collectionMaxId(c.address) || Math.max(0, stats.supply - 1), 1).catch(() => ({ rows: [] }));
    const coverMeta = coverPage.rows.length ? coverPage.rows[0].meta : null;
    const coverImg = coverMeta ? safeImage(coverMeta.image) : '';
    const floor = stats.floor != null ? fmtEth(stats.floor) + ' ETH' : '-';
    const cover = coverImg ? '<img src="' + esc(coverImg) + '" alt="' + esc(name) + '" loading="lazy" />' : '<span class="noimg">' + esc(name) + '</span>';
    return '<a class="collection-card" href="#/collection/' + esc(c.slug || c.address) + '">'
      + '<div class="collection-cover">' + cover + '</div>'
      + '<div class="collection-name">' + esc(name) + '</div>'
      + '<div class="collection-meta">' + fmtNum(stats.supply) + ' items · floor ' + esc(floor) + ' · ' + esc(statCount(stats.listed)) + ' listed</div>'
      + '</a>';
  }));
  view.innerHTML = '<section class="hero"><h1>Explore <span class="accent">collections</span></h1><p class="lede">Browse every collection on Squeek Market.</p></section>'
    + '<section class="section"><div class="section-head"><h2>Collections</h2><p class="muted">' + cols.length + ' collection' + (cols.length === 1 ? '' : 's') + '</p></div>'
    + '<div class="collections-grid">' + cards.join('') + '</div></section>';
}

/* ---------- Collection ---------- */
async function renderCollection(view, nft) {
  const col = collectionMeta(nft);
  if (!col) { view.innerHTML = emptyHtml('This collection is not listed on Squeek Market.'); return; }
  const [stats, name, creator] = await Promise.all([
    fetchCollectionStats(nft),
    nftRead(nft).name().catch(() => col ? col.name : 'Collection'),
    fetchContractCreator(nft),
  ]);
  const PAGE = 30;
  const maxId = collectionMaxId(nft) || Math.max(1, stats.supply - 1);
  if (collectionCursor == null) collectionCursor = maxId;
  const { rows: validRows, nextStart } = await fetchValidTokens(nft, collectionCursor, PAGE);
  const rows = validRows.map((r) => ({ tokenId: r.id, meta: r.meta, owner: r.owner }));
  const listedMetas = await Promise.all(stats.listedRows.map(async (l) => ({ ...l, meta: await fetchMetadata(nft, l.tokenId) })));

  const floor = stats.floor != null ? fmtEth(stats.floor) + ' ETH' : '-';
  let about = '';
  for (const m of rows) { if (m.meta && m.meta.description) { about = m.meta.description; break; } }
  const isSqueek = nft && String(nft).toLowerCase() === SQ().toLowerCase();
  const aboutExtra = isSqueek ? SQUEEK_OVERVIEW : '';
  const docsLink = col && col.docs ? col.docs : null;

  const pageInfo = rows.length ? ('#' + esc(rows[rows.length - 1].tokenId) + ' to #' + esc(rows[0].tokenId)) : 'none';
  const allHtml = (rows.length ? '<div id="cgrid" class="grid">' + rows.map((r) => cardHtml(nft, r.tokenId, r.meta, { owner: r.owner })).join('') + '</div>' : emptyHtml('No items here yet.'))
    + '<div class="pager"><button id="prev" class="btn btn-ghost btn-sm">Older items</button><span class="page-info">' + pageInfo + '</span></div>';
  const itemHtml = listedMetas.length
    ? '<div class="grid">' + listedMetas.map((l) => cardHtml(nft, l.tokenId, l.meta, { price: l.price, owner: l.seller })).join('') + '</div>'
    : emptyHtml('No items listed for sale yet.');
  const logoImg = rows.find((m) => m.meta && m.meta.image) || null;
  const logo = logoImg ? safeImage(logoImg.meta.image) : '';

  view.innerHTML = '<section class="hero"><div class="profile-head collection-head">'
    + (logo ? '<img class="collection-logo" src="' + esc(logo) + '" alt="' + esc(name) + '" />' : '<span class="collection-logo noimg">' + esc(name) + '</span>')
    + '<div class="profile-id"><h1>' + esc(name) + '</h1>'
    + '<div class="collection-created mono-hint">Created by ' + (creator ? addrLink(creator, fmtAddr(creator)) : 'unknown') + ' · ' + fmtNum(stats.supply) + ' items</div>'
    + '</div></div>'
    + '<div class="hero-stats">'
    + statHtml('Floor Price', floor)
    + statHtml('1D Floor', '-')
    + statHtml('Top Offer', stats.topOffer != null ? fmtEth(stats.topOffer) + ' ETH' : '-')
    + statHtml('24H Volume', '-')
    + statHtml('Total Volume', stats.volume > 0n ? fmtWei(stats.volume) + ' ETH' : '-')
    + statHtml('Listed', statCount(stats.listed))
    + '</div>'
    + '</section>'
    + (about || aboutExtra ? '<section class="section about"><h2>About</h2>'
      + (about ? '<p class="muted about-body">' + esc(about) + '</p>' : '')
      + (aboutExtra ? '<p class="muted about-body about-more clamp" id="about-more">' + esc(aboutExtra) + '</p><button class="about-toggle" id="about-toggle" type="button">Read more</button>' : '')
      + (docsLink ? '<p class="about-link"><a class="hl" href="' + esc(docsLink) + '" target="_blank" rel="noopener">Read the full docs</a></p>' : '')
      + '</section>' : '')
    + '<section class="section">'
    + '<div class="collection-toolbar"><div class="tabs"><button class="tab is-active" data-ctab="explore">Explore</button><button class="tab" data-ctab="item">Item</button><button class="tab" data-ctab="mine">My Item</button><button class="tab" data-ctab="offer">Offer</button><button class="tab" data-ctab="activity">Activity</button></div>'
    + '<span class="muted mono-hint">' + esc(stats.supply) + ' items · <a class="hl" href="' + esc(CONFIG.EXPLORER_ADDR(nft)) + '" target="_blank" rel="noopener">' + esc(fmtAddr(nft)) + '</a></span></div>'
    + '<div id="ctab-explore">' + allHtml + '</div>'
    + '<div id="ctab-item" hidden>' + itemHtml + '</div>'
    + '<div id="ctab-mine" hidden><div class="loading"><span class="spin"></span>Loading your items…</div></div>'
    + '<div id="ctab-offer" hidden><div class="loading"><span class="spin"></span>Loading offers…</div></div>'
    + '<div id="ctab-activity" hidden><div class="loading"><span class="spin"></span>Loading activity…</div></div>'
    + '</section>';
  const prevBtn = view.querySelector('#prev');
  if (nextStart <= 0) { prevBtn.disabled = true; }
  else prevBtn.addEventListener('click', async () => { collectionCursor = nextStart; router(); });

  const aboutToggle = view.querySelector('#about-toggle');
  if (aboutToggle) aboutToggle.addEventListener('click', () => {
    const p = view.querySelector('#about-more');
    if (p) {
      const clamped = p.classList.toggle('clamp');
      aboutToggle.textContent = clamped ? 'Read more' : 'Show less';
    }
  });

  const cshow = (n) => ['explore', 'item', 'mine', 'offer', 'activity'].forEach((k) => { const el = view.querySelector('#ctab-' + k); if (el) el.hidden = (k !== n); });
  view.querySelectorAll('[data-ctab]').forEach((tab) => tab.addEventListener('click', async () => {
    view.querySelectorAll('[data-ctab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    const name = tab.dataset.ctab;
    cshow(name);
    if (name === 'mine') {
      const mine = view.querySelector('#ctab-mine');
      if (!mine.dataset.loaded) {
        if (!signerAddr) {
          mine.innerHTML = '<div class="empty state">Connect your wallet to see the items you own.</div>';
        } else {
          const owned = await fetchOwnedTokens(nft, signerAddr);
          const oM = await Promise.all(owned.map(async (id) => ({ id, meta: await fetchMetadata(nft, id) })));
          mine.innerHTML = oM.length
            ? '<div class="grid">' + oM.map((o) => cardHtml(nft, o.id, o.meta, { owner: signerAddr })).join('') + '</div>'
            : emptyHtml('You own no items yet.');
        }
        mine.dataset.loaded = '1';
      }
    } else if (name === 'offer') {
      const off = view.querySelector('#ctab-offer');
      if (!off.dataset.loaded) {
        if (!signerAddr) {
          off.innerHTML = '<div class="empty state">Connect your wallet to see and manage the offers you made.</div>';
        } else {
          const evs = await fetchMarketEvents(nft);
          const okey = (args) => String(args.tokenId) + ':' + String(args.offerer).toLowerCase();
          const closed = new Set(evs.filter((ev) => ev.fragment && (ev.fragment.name === 'OfferCancelled' || ev.fragment.name === 'OfferAccepted')).map((ev) => okey(ev.args)));
          const offers = evs.filter((ev) => ev.fragment && ev.fragment.name === 'OfferMade' && ev.args.offerer && String(ev.args.offerer).toLowerCase() === signerAddr.toLowerCase() && !closed.has(okey(ev.args)));
          off.innerHTML = offers.length
            ? '<div class="feed">' + offers.map((ev) => {
                const a = ev.args;
                return '<div class="offer-row"><div class="info"><div class="amount"><a class="hl" href="#/nft/' + esc(collectionSlug(a.nft)) + '/' + esc(a.tokenId) + '">' + esc(itemLabel(a.nft, a.tokenId)) + '</a></div><div class="faint">' + esc(fmtEth(a.price)) + ' ETH</div></div><a class="btn btn-ghost btn-sm" href="#/nft/' + esc(collectionSlug(a.nft)) + '/' + esc(a.tokenId) + '">Manage</a></div>';
              }).join('') + '</div>'
            : emptyHtml('You made no offers yet. Open an item and place an offer.');
        }
        off.dataset.loaded = '1';
      }
    } else if (name === 'activity') {
      const act = view.querySelector('#ctab-activity');
      if (!act.dataset.loaded) { act.innerHTML = activityFeedHtml(await fetchMarketEvents(nft)); act.dataset.loaded = '1'; }
    }
  }));
}

/* ---------- NFT detail ---------- */
async function tokenHistoryHtml(nft, tokenId) {
  const evs = await fetchMarketEvents(nft);
  const mine = evs.filter((ev) => ev.args && ev.args.tokenId != null && Number(ev.args.tokenId) === Number(tokenId));
  return activityFeedHtml(mine);
}

async function renderNft(view, nft, rawId) {
  const tokenId = Number(rawId);
  if (!Number.isInteger(tokenId) || tokenId < 0) { view.innerHTML = emptyHtml('Invalid token id.'); return; }
  if (!collectionMeta(nft)) { view.innerHTML = emptyHtml('This item is not from a collection on Squeek Market.'); return; }
  const [meta, listing, offer] = await Promise.all([
    fetchMetadata(nft, tokenId),
    fetchListing(nft, tokenId),
    fetchOffer(nft, tokenId),
  ]);
  const owner = meta.owner;
  const royalty = await fetchRoyalty(nft, tokenId, listing.active ? listing.price : 0n);
  const royaltyBps = listing.active && listing.price > 0n ? Math.round(Number(royalty.amount) / Number(listing.price) * 10000) : 0;

  const img = safeImage(meta.image);
  const attrList = (meta.attrs || []).slice(0, 24);
  const attrs = attrList.map((a) => '<div class="trait"><span class="t-type">' + esc(a.trait_type) + '</span><span class="t-val">' + esc(a.value) + '</span></div>').join('');
  const label = itemLabel(nft, tokenId);

  const isMine = signerAddr && owner && signerAddr.toLowerCase() === owner.toLowerCase();
  const isSeller = signerAddr && listing.active && signerAddr.toLowerCase() === listing.seller.toLowerCase();
  const isOfferer = signerAddr && offer.active && signerAddr.toLowerCase() === offer.offerer.toLowerCase();

  let actionHtml = '';
  if (listing.active) {
    actionHtml = '<div class="action-box"><h3>Listed for ' + esc(fmtEth(listing.price)) + ' ETH</h3>'
      + '<div class="price-line"><span>Seller</span><span>' + addrLink(listing.seller) + '</span></div>'
      + (royaltyBps ? '<div class="price-line"><span>Creator royalty (' + esc((royaltyBps / 100)) + '%)</span><span>' + esc(fmtEth(royalty.amount)) + ' ETH</span></div>' : '')
      + '<div class="price-line total"><span>Total</span><span>' + esc(fmtEth(listing.price)) + ' ETH</span></div>'
      + (isSeller
        ? '<button class="btn btn-danger btn-block" data-act="cancel" data-token="' + tokenId + '">Cancel listing</button>'
        : '<button class="btn btn-primary btn-block" data-act="buy" data-token="' + tokenId + '" data-price="' + listing.price + '">Buy now</button>'
          + '<div class="price-line sep">or make an offer</div>'
          + '<label class="field"><span class="field-label">Offer (ETH)</span><input id="offer-price" class="input mono" inputmode="decimal" placeholder="0.1" /></label>'
          + '<button class="btn btn-ghost btn-block" data-act="offer" data-token="' + tokenId + '">Make offer</button>'
          + '<p class="hint">Your ETH is held in an onchain escrow until the owner accepts or you cancel.</p>')
      + '<p class="hint">0% marketplace fee.</p></div>';
  } else if (owner) {
    if (isMine) {
      actionHtml = '<div class="action-box"><h3>You own this item</h3>'
        + '<label class="field"><span class="field-label">Price (ETH)</span><input id="list-price" class="input mono" inputmode="decimal" placeholder="0.05" /></label>'
        + '<button class="btn btn-primary btn-block" data-act="list" data-token="' + tokenId + '">List for sale</button>'
        + '<p class="hint">Listing moves the item into an onchain escrow until sold or cancelled.</p></div>';
    } else {
      actionHtml = '<div class="action-box"><h3>Make an offer</h3>'
        + '<label class="field"><span class="field-label">Offer (ETH)</span><input id="offer-price" class="input mono" inputmode="decimal" placeholder="0.1" /></label>'
        + '<button class="btn btn-primary btn-block" data-act="offer" data-token="' + tokenId + '">Make offer</button>'
        + '<p class="hint">Your ETH is held in an onchain escrow until the owner accepts or you cancel.</p></div>';
    }
  }

  let offerHtml = '';
  if (offer.active) {
    const exp = new Date(Number(offer.expiry) * 1000).toLocaleString();
    offerHtml = '<div class="action-box"><h3>Open offer of ' + esc(fmtEth(offer.price)) + ' ETH</h3>'
      + '<div class="price-line"><span>By</span><span>' + addrLink(offer.offerer) + '</span></div>'
      + '<div class="price-line"><span>Expires</span><span>' + esc(exp) + '</span></div>'
      + (isMine ? '<button class="btn btn-primary btn-block" data-act="accept" data-token="' + tokenId + '" data-offerer="' + offer.offerer + '">Accept offer</button>' : '')
      + (isOfferer ? '<button class="btn btn-danger btn-block" data-act="cancel-offer" data-token="' + tokenId + '">Cancel offer</button>' : '')
      + '</div>';
  }

  const history = await tokenHistoryHtml(nft, tokenId);

  view.innerHTML = '<div class="nft-layout">'
    + '<div><div class="nft-art">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(label) + '" />' : '<span class="noimg">' + esc(label) + '</span>') + '</div></div>'
    + '<div class="nft-info">'
    + '<a class="nft-breadcrumb hl" href="#/collection/' + esc(collectionSlug(nft)) + '">← ' + esc(collectionName(nft)) + '</a>'
    + '<h1>' + esc(meta.name || label) + '</h1>'
    + offerHtml + actionHtml
    + '<div class="kv">'
    + '<div class="kv-row"><span class="k">Token id</span><span class="v">#' + esc(tokenId) + '</span></div>'
    + '<div class="kv-row"><span class="k">Owner</span><span class="v">' + (owner ? addrLink(owner) : 'unavailable') + '</span></div>'
    + '<div class="kv-row"><span class="k">Contract</span><span class="v"><a class="hl" href="' + esc(CONFIG.EXPLORER_ADDR(nft)) + '" target="_blank" rel="noopener">' + esc(fmtAddr(nft)) + '</a></span></div>'
    + '</div>'
    + (attrs ? '<details class="traits-box"><summary>Traits <span class="muted">(' + attrList.length + ')</span></summary><div class="traits">' + attrs + '</div></details>' : '')
    + (meta.description ? '<div class="nft-about"><h2>About</h2><p class="muted">' + esc(meta.description) + '</p></div>' : '')
    + '</div></div>'
    + '<section class="section"><div class="section-head"><h2>Activity</h2></div>' + history + '</section>';
  bindActions(view, nft, tokenId);
}

function bindActions(view, nft, tokenId) {
  view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'buy') doBuy(nft, tokenId, BigInt(b.dataset.price));
    else if (act === 'list') doList(nft, tokenId);
    else if (act === 'cancel') doCancel(nft, tokenId);
    else if (act === 'offer') doOffer(nft, tokenId);
    else if (act === 'accept') doAccept(nft, tokenId, b.dataset.offerer);
    else if (act === 'cancel-offer') doCancelOffer(nft, tokenId);
  }));
}

/* ---------- Activity ---------- */
function activityFeedHtml(evs) {
  const rows = evs.map((ev) => {
    const name = ev.fragment ? ev.fragment.name : 'Event';
    let cls = 'ev-badge', body = '';
    const a = ev.args;
    if (name === 'Listed') { body = '<strong>#' + esc(a.tokenId) + '</strong> listed for ' + esc(fmtEth(a.price)) + ' ETH by ' + addrLink(a.seller); }
    else if (name === 'Sold') { cls += ' sale'; body = '<strong>#' + esc(a.tokenId) + '</strong> sold for ' + esc(fmtEth(a.price)) + ' ETH to ' + addrLink(a.buyer); }
    else if (name === 'Cancelled') { cls += ' cancel'; body = '<strong>#' + esc(a.tokenId) + '</strong> listing cancelled by ' + addrLink(a.seller); }
    else if (name === 'OfferMade') { cls += ' offer'; body = 'Offer of ' + esc(fmtEth(a.price)) + ' ETH on <strong>#' + esc(a.tokenId) + '</strong> by ' + addrLink(a.offerer); }
    else if (name === 'OfferCancelled') { cls += ' cancel'; body = 'Offer on <strong>#' + esc(a.tokenId) + '</strong> cancelled by ' + addrLink(a.offerer); }
    else if (name === 'OfferAccepted') { cls += ' sale'; body = 'Offer of ' + esc(fmtEth(a.price)) + ' ETH on <strong>#' + esc(a.tokenId) + '</strong> accepted by ' + addrLink(a.seller); }
    else { body = 'Event ' + esc(name); }
    return '<div class="feed-row"><span class="' + cls + '">' + esc(name) + '</span><div class="ev-body">' + body + '<div class="who">Block ' + esc(ev.blockNumber) + txLink(ev.transactionHash) + '</div></div></div>';
  }).join('');
  return rows ? '<div class="feed">' + rows + '</div>' : emptyHtml('No activity yet. Sales, offers, and listings will appear here.');
}

/* ---------- Profile ---------- */
function loadProfile(addr) {
  try { return JSON.parse(localStorage.getItem('profile:' + String(addr).toLowerCase()) || '{}'); } catch (e) { return {}; }
}
function saveProfile(addr, name, bio) {
  try { localStorage.setItem('profile:' + String(addr).toLowerCase(), JSON.stringify({ name, bio })); } catch (e) {}
}
async function renderProfile(view, addr) {
  if (!addr) {
    if (signerAddr) { location.hash = '#/profile/' + signerAddr; return; }
    view.innerHTML = '<section class="hero"><h1>Profile</h1><p class="lede">Connect your wallet to see your collections and activity.</p><button id="c-btn" class="btn btn-primary">Connect wallet</button></section>';
    view.querySelector('#c-btn').addEventListener('click', connect);
    return;
  }
  const isMe = signerAddr && addr.toLowerCase() === signerAddr.toLowerCase();

  const [owned, listings, events, ethBal] = await Promise.all([
    fetchOwnedTokens(SQ(), addr),
    fetchListings(),
    fetchMarketEvents(),
    getReadProvider().getBalance(addr),
  ]);
  const prof = loadProfile(addr);
  const myListings = listings.filter((l) => l.seller.toLowerCase() === addr.toLowerCase());
  const myEvents = events.filter((ev) => eventInvolves(ev, addr));
  const sold = myEvents.filter((ev) => ev.fragment && ev.fragment.name === 'Sold');
  const okey = (args) => String(args.tokenId) + ':' + String(args.offerer || '').toLowerCase();
  const closedOffers = new Set(myEvents.filter((ev) => ev.fragment && (ev.fragment.name === 'OfferCancelled' || ev.fragment.name === 'OfferAccepted')).map((ev) => okey(ev.args)));
  const offersMade = myEvents.filter((ev) => ev.fragment && ev.fragment.name === 'OfferMade' && !closedOffers.has(okey(ev.args)));

  const header = '<section class="hero"><div class="profile-head">'
    + identiconHtml(addr, 72)
    + '<div class="profile-id">' + (prof.name ? '<h1>' + esc(prof.name) + '</h1>' : '')
    + (prof.bio ? '<div class="profile-bio muted">' + esc(prof.bio) + '</div>' : '')
    + '<div class="profile-addr mono-hint"><span class="mono">' + esc(addr) + '</span> <button class="btn btn-ghost btn-sm" data-copy="' + esc(addr) + '">Copy</button> <a class="hl" href="' + esc(CONFIG.EXPLORER_ADDR(addr)) + '" target="_blank" rel="noopener">Explorer</a></div>'
    + '</div>'
    + (isMe ? '<button class="btn btn-ghost btn-sm edit-btn" id="edit-btn">Edit profile</button>' : '')
    + '</div>'
    + '<div class="portfolio"><span class="stat-label">Portfolio value</span><span class="portfolio-val">' + esc(fmtWei(ethBal)) + ' ETH</span></div>'
    + '</section>';

  const ownedMetas = await Promise.all(owned.map(async (id) => ({ id, meta: await fetchMetadata(SQ(), id) })));
  const holdingsHtml = ownedMetas.length
    ? '<div class="grid">' + ownedMetas.map((o) => cardHtml(SQ(), o.id, o.meta, { owner: addr })).join('') + '</div>'
    : emptyHtml('No items.');

  const actHtml = myEvents.length ? activityFeedHtml(myEvents) : emptyHtml('No activity yet.');

  const listRow = myListings.length
    ? myListings.map((l) => '<div class="offer-row"><div class="info"><div class="amount"><a class="hl" href="#/nft/' + esc(collectionSlug(l.nft)) + '/' + esc(l.tokenId) + '">' + esc(itemLabel(l.nft, l.tokenId)) + '</a></div><div class="faint">' + esc(fmtEth(l.price)) + ' ETH · active</div></div><button class="btn btn-danger btn-sm" data-act="cancel" data-token="' + esc(l.tokenId) + '" data-nft="' + esc(l.nft) + '">Cancel</button></div>').join('')
    : emptyHtml('No active listings.');
  const offersRow = offersMade.length
    ? offersMade.map((ev) => '<div class="offer-row"><div class="info"><div class="amount"><a class="hl" href="#/nft/' + esc(collectionSlug(ev.args.nft)) + '/' + esc(ev.args.tokenId) + '">' + esc(itemLabel(ev.args.nft, ev.args.tokenId)) + '</a></div><div class="faint">' + esc(fmtEth(ev.args.price)) + ' ETH</div></div><a class="btn btn-ghost btn-sm" href="#/nft/' + esc(collectionSlug(ev.args.nft)) + '/' + esc(ev.args.tokenId) + '">Manage</a></div>').join('')
    : emptyHtml('No offers made.');

  const tradesHtml = sold.length
    ? sold.map((ev) => {
        const a = ev.args;
        const bought = a.buyer && String(a.buyer).toLowerCase() === addr.toLowerCase();
        const other = bought ? a.seller : a.buyer;
        return '<div class="offer-row"><div class="info"><div class="amount">' + esc(bought ? 'Bought' : 'Sold') + ' · <a class="hl" href="#/nft/' + esc(collectionSlug(a.nft)) + '/' + esc(a.tokenId) + '">' + esc(itemLabel(a.nft, a.tokenId)) + '</a></div><div class="faint">' + esc(fmtEth(a.price)) + ' ETH · other ' + addrLink(other) + '</div></div><a class="btn btn-ghost btn-sm" href="#/nft/' + esc(collectionSlug(a.nft)) + '/' + esc(a.tokenId) + '">View</a></div>';
      }).join('')
    : emptyHtml('No trades yet.');

  view.innerHTML = header
    + '<section class="section"><div class="tabs profile-tabs">'
    + '<button class="tab is-active" data-ptab="holdings">Holdings</button><button class="tab" data-ptab="activity">Activity</button><button class="tab" data-ptab="orders">Orders</button><button class="tab" data-ptab="trades">Trades</button></div>'
    + '<div id="ptab-holdings">' + holdingsHtml + '</div>'
    + '<div id="ptab-activity" hidden><div class="section-head"><h2>Activity</h2></div>' + actHtml + '</div>'
    + '<div id="ptab-orders" hidden><div class="section-head"><h2>Orders</h2></div><div class="section-sub">Listings</div>' + listRow + '<div class="section-sub">Offers</div>' + offersRow + '</div>'
    + '<div id="ptab-trades" hidden><div class="section-head"><h2>Trades</h2></div>' + tradesHtml + '</div>'
    + '</section>';

  view.querySelectorAll('[data-ptab]').forEach((tab) => tab.addEventListener('click', () => {
    view.querySelectorAll('[data-ptab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    ['holdings', 'activity', 'orders', 'trades'].forEach((k) => { const el = view.querySelector('#ptab-' + k); if (el) el.hidden = (k !== tab.dataset.ptab); });
  }));
  view.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Address copied.'); } catch (e) { toast('Copy failed.'); }
  }));
  const editBtn = view.querySelector('#edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => openEditProfile(addr));
  // profile "Cancel" buttons re-use the marketplace cancel, so wire them up too
  view.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'cancel') doCancel(b.dataset.nft, b.dataset.tokenId);
  }));
}

function openEditProfile(addr) {
  const prof = loadProfile(addr);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = '<div class="modal"><h3>Edit profile</h3>'
    + '<label class="field"><span class="field-label">Name</span><input id="ep-name" class="input" maxlength="40" value="' + esc(prof.name || '') + '" placeholder="Display name" /></label>'
    + '<label class="field"><span class="field-label">Bio</span><textarea id="ep-bio" class="input" rows="3" maxlength="200" placeholder="A short line about yourself">' + esc(prof.bio || '') + '</textarea></label>'
    + '<div class="modal-actions"><button class="btn btn-ghost" id="ep-cancel">Cancel</button><button class="btn btn-primary" id="ep-save">Save</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('#ep-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#ep-save').addEventListener('click', () => {
    saveProfile(addr, modal.querySelector('#ep-name').value.trim(), modal.querySelector('#ep-bio').value.trim());
    modal.remove();
    toast('Profile updated.');
    router();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/* ---------- actions ---------- */
function needWallet() {
  if (!signerAddr) { toast('Connect your wallet first.'); return false; }
  return true;
}
async function doBuy(nft, tokenId, price) {
  if (!needWallet()) return;
  try {
    toast('Confirm the buy in your wallet…');
    const tx = await marketWrite().buy(nft, tokenId, { value: price });
    toast('Waiting for confirmation…' + txLink(tx.hash));
    await tx.wait();
    toast(itemLabel(nft, tokenId) + ' bought.' + txLink(tx.hash));
    router();
  } catch (e) { toast('Buy failed: ' + esc(e.shortMessage || e.message)); }
}
async function doList(nft, tokenId) {
  if (!needWallet()) return;
  const inp = $('list-price');
  const val = inp ? inp.value.trim() : '';
  let priceWei;
  try { priceWei = ethers.parseEther(val); } catch { toast('Enter a valid price.'); return; }
  try {
    const approved = await nftRead(nft).isApprovedForAll(signerAddr, CONFIG.MARKET);
    if (!approved) {
      toast('Approve the marketplace to move your items (first time only)…');
      const atx = await nftWrite(nft).setApprovalForAll(CONFIG.MARKET, true);
      await atx.wait();
      toast('Approved. ' + txLink(atx.hash));
    }
    const tx = await marketWrite().list(nft, tokenId, priceWei);
    toast('Listing… this moves your item into escrow.' + txLink(tx.hash));
    await tx.wait();
    toast('Listed ' + itemLabel(nft, tokenId) + ' for ' + esc(val) + ' ETH.' + txLink(tx.hash));
    router();
  } catch (e) { toast('List failed: ' + esc(e.shortMessage || e.message)); }
}
async function doCancel(nft, tokenId) {
  if (!needWallet()) return;
  try {
    const tx = await marketWrite().cancel(nft, tokenId);
    toast('Cancelling…' + txLink(tx.hash));
    await tx.wait();
    toast('Cancelled. ' + itemLabel(nft, tokenId) + ' returned to your wallet.' + txLink(tx.hash));
    router();
  } catch (e) { toast('Cancel failed: ' + esc(e.shortMessage || e.message)); }
}
async function doOffer(nft, tokenId) {
  if (!needWallet()) return;
  const inp = $('offer-price');
  const val = inp ? inp.value.trim() : '';
  let priceWei;
  try { priceWei = ethers.parseEther(val); } catch { toast('Enter a valid amount.'); return; }
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
  try {
    const tx = await marketWrite().makeOffer(nft, tokenId, expiry, { value: priceWei });
    toast('Making offer… your ETH will be escrowed.' + txLink(tx.hash));
    await tx.wait();
    toast('Offer of ' + esc(val) + ' ETH made.' + txLink(tx.hash));
    router();
  } catch (e) { toast('Offer failed: ' + esc(e.shortMessage || e.message)); }
}
async function doAccept(nft, tokenId, offerer) {
  if (!needWallet()) return;
  try {
    const tx = await marketWrite().acceptOffer(nft, tokenId, offerer);
    toast('Accepting offer…' + txLink(tx.hash));
    await tx.wait();
    toast('Offer accepted. ' + itemLabel(nft, tokenId) + ' transferred.' + txLink(tx.hash));
    router();
  } catch (e) { toast('Accept failed: ' + esc(e.shortMessage || e.message)); }
}
async function doCancelOffer(nft, tokenId) {
  if (!needWallet()) return;
  try {
    const tx = await marketWrite().cancelOffer(nft, tokenId);
    toast('Cancelling offer…' + txLink(tx.hash));
    await tx.wait();
    toast('Offer cancelled. ETH returned.' + txLink(tx.hash));
    router();
  } catch (e) { toast('Cancel offer failed: ' + esc(e.shortMessage || e.message)); }
}

/* ---------- feedback ---------- */
let _fbType = null;
function renderFeedbackTypes() {
  const el = $('fb-types');
  el.innerHTML = (CONFIG.FEEDBACK_TYPES || []).map((t) =>
    '<button type="button" class="fb-type" data-type="' + t.id + '"><span class="fb-type-label">' + esc(t.label) + '</span><span class="fb-type-hint">' + esc(t.hint) + '</span></button>'
  ).join('');
  el.querySelectorAll('.fb-type').forEach((b) => b.addEventListener('click', () => {
    _fbType = b.dataset.type;
    el.querySelectorAll('.fb-type').forEach((x) => x.classList.toggle('is-active', x === b));
  }));
}
function openFeedback() { $('fb-overlay').hidden = false; $('fb-msg').focus(); }
function closeFeedback() { $('fb-overlay').hidden = true; }
async function submitFeedback() {
  const type = (CONFIG.FEEDBACK_TYPES || []).find((t) => t.id === _fbType);
  const msg = ($('fb-msg').value || '').trim();
  const contact = ($('fb-contact').value || '').trim();
  if (!type) { toast('Pick a feedback type first.'); return; }
  if (!msg) { toast('Write something first.'); return; }
  if (!CONFIG.FEEDBACK_URL) { toast('Feedback form is not wired up yet.'); return; }
  const btn = $('fb-submit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch(CONFIG.FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type.label, message: msg, contact: contact, page: location.href }),
    });
    if (r.ok) {
      closeFeedback();
      $('fb-msg').value = ''; $('fb-contact').value = '';
      _fbType = null;
      const typesEl = $('fb-types'); typesEl.querySelectorAll('.fb-type').forEach((x) => x.classList.remove('is-active'));
      toast('Thanks for your feedback!');
    } else {
      toast('Could not send feedback. Try again.');
    }
  } catch (e) {
    toast('Could not send feedback (network). Try again.');
  }
  btn.disabled = false; btn.textContent = 'Send feedback';
}

/* ---------- init ---------- */
initWalletProviders(renderWallet);
renderFeedbackTypes();
$('fb-btn').addEventListener('click', openFeedback);
$('fb-cancel').addEventListener('click', closeFeedback);
$('fb-submit').addEventListener('click', submitFeedback);
$('fb-overlay').addEventListener('click', (e) => { if (e.target === $('fb-overlay')) closeFeedback(); });
window.addEventListener('load', () => {
  renderWallet();
  router();
  // restore the wallet in the background — never block the first paint on
  // a slow/hung wallet, or the page stays black until the extension responds.
  restoreWallet().then(() => { renderWallet(); router(); });
});
window.addEventListener('hashchange', () => router());
if (window.ethereum) {
  try {
    window.ethereum.on('accountsChanged', (accounts) => {
      const first = Array.isArray(accounts) ? accounts[0] : null;
      if (!first) {
        disconnectWallet();
        renderWallet();
        router();
      } else if (signerAddr && first.toLowerCase() !== signerAddr.toLowerCase()) {
        connect();
      }
    });
    window.ethereum.on('chainChanged', () => router());
  } catch (e) { /* ignore */ }
}