/* ============================================================
   Steam Inventory Viewer — App Logic
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────────
const state = {
  apiKey: '',
  steamId: '',
  appId: '',
  mode: 'apikey',        // 'apikey' | 'public'
  publicAppId: '730',
  allItems: [],
  filteredItems: [],
  displayCount: 60,
  PAGE_SIZE: 60,
  view: 'grid',          // 'grid' | 'list'
  currentItem: null,
};

// ── Steam Inventory Endpoints (cascade) ────────────────────────
// Steam 提供多种公开库存接口，按可用性优先级排列
// 方案1: Steam 官方 inventory JSON API（需浏览器携带正确 Cookie/Referer）
// 方案2: SteamSpy 代理（无限制）
// 方案3: 通过 steam.tools 镜像接口
// 方案4: 直连 + 降级提示

const CF_WORKER_URL = 'https://steam-cors-proxy-257523kk0wsw.claudwang.deno.net'; // Deno Deploy 代理

// 构建各种可能的库存请求 URL
function buildInventoryUrls(sid64, appid, ctxid) {
  const steamUrl = `https://steamcommunity.com/inventory/${sid64}/${appid}/${ctxid}?l=schinese&count=5000`;
  const urls = [];

  // 0. 自建 CF Worker（最优先，如果配置了的话）
  if (CF_WORKER_URL) {
    urls.push({ url: `${CF_WORKER_URL}?target=${encodeURIComponent(steamUrl)}`, mode: 'json' });
  }

  // 1. steam.tools 公开镜像（专门代理 Steam 库存，通常可用）
  urls.push({ url: `https://www.steamwebapi.com/steam/api/inventory?key=&steam_id=${sid64}&game_id=${appid}`, mode: 'steamwebapi' });

  // 2. Steam 官方路径（直连，在 GitHub Pages 域名下通常会被 CORS 拦截，但可作为最后一试）
  urls.push({ url: steamUrl, mode: 'json' });

  return urls;
}

// Steam API endpoint
const STEAM_INV_URL = (sid64, appid, ctxid = 2) =>
  `https://steamcommunity.com/inventory/${sid64}/${appid}/${ctxid}?l=schinese&count=5000`;

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initTabs();

  // Restore last session
  const saved = sessionStorage.getItem('steam_inv_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      Object.assign(state, s);
    } catch (_) {}
  }
});

// ── Particles ───────────────────────────────────────────────────
function initParticles() {
  const container = document.getElementById('bgParticles');
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 300 + 100;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 20 + 15}s;
      animation-delay:${Math.random() * -20}s;
    `;
    container.appendChild(p);
  }
}

// ── Tabs ────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab' + capitalize(tab.dataset.tab));
      if (target) target.classList.add('active');
      state.mode = tab.dataset.tab;
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function setAppId(val) {
  document.getElementById('appIdInput').value = val;
  state.appId = val;
}

let _publicAppId = '730';
function setPublicAppId(val, btn) {
  _publicAppId = val;
  document.querySelectorAll('#tabPublic .qg-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function toggleVisible(inputId, btn) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ── SteamID helpers ─────────────────────────────────────────────
function extractSteamId64(raw) {
  raw = raw.trim();
  // Already 64-bit
  if (/^\d{17}$/.test(raw)) return raw;
  // steamcommunity.com/profiles/76561198...
  const m1 = raw.match(/profiles\/(\d{17})/);
  if (m1) return m1[1];
  // steamcommunity.com/id/vanityName — need API to resolve, return null
  return null;
}

// ── Fetch Steam API with CORS proxy cascade ──────────────────────
const CORS_PROXIES = [
  // 1. corsproxy.io - 支持自定义 header 透传
  url => ({ url: `https://corsproxy.io/?${encodeURIComponent(url)}`, headers: {} }),
  // 2. allorigins
  url => ({ url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, headers: {} }),
  // 3. 直连（适合部分非严格 CORS 的接口，如 Steam Web API）
  url => ({ url, headers: { 'Origin': 'https://steamcommunity.com' } }),
];

async function fetchWithProxy(url) {
  let lastErr;
  for (const buildReq of CORS_PROXIES) {
    try {
      const { url: reqUrl, headers } = buildReq(url);
      const res = await fetch(reqUrl, {
        signal: AbortSignal.timeout(12000),
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      console.warn(`[fetchWithProxy] failed:`, e.message);
    }
  }
  throw lastErr || new Error('All proxies failed');
}

// ── Fetch Steam Inventory specifically ───────────────────────────
async function fetchSteamInventory(sid64, appid, ctxid) {
  const errors = [];
  const steamUrl = STEAM_INV_URL(sid64, appid, ctxid);

  // ── 方案 A: 自建 Deno 代理（最可靠）──
  if (CF_WORKER_URL) {
    try {
      // 浏览器 fetch 会自动对 URL 做一层编码，所以这里用 encodeURIComponent 会造成双重编码
      // 解决方案：用 btoa 编码 target，代理端 atob 解码，完全绕开 URL 编码问题
      const encodedTarget = btoa(unescape(encodeURIComponent(steamUrl)));
      const proxyUrl = `${CF_WORKER_URL}?b64target=${encodedTarget}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      console.log(`[Deno Proxy] status=${res.status}, preview=${text.substring(0, 80)}`);

      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error(`Non-JSON: ${text.substring(0,100)}`); }

      // 代理正常转发，Steam 返回库存为私密或空
      if (data.rwgrsn === -2) throw new Error('PRIVATE_INVENTORY');
      // 代理正常，有数据（即使 assets 为空也返回，让上层处理）
      if (data.success !== undefined || data.assets !== undefined) {
        console.log('[Deno Proxy] success');
        return data;
      }
      // 代理返回了错误 JSON（如 {error: "..."})
      if (data.error) throw new Error(`Proxy error: ${data.error}`);
      // 其他情况也尝试返回
      return data;
    } catch (e) {
      if (e.message === 'PRIVATE_INVENTORY') throw e;
      errors.push(`Deno Proxy: ${e.message}`);
      console.warn('[Deno Proxy] failed:', e.message);
    }
  }

  // ── 方案 B: corsproxy.io ──
  const proxyConfigs = [
    { name: 'corsproxy.io', url: `https://corsproxy.io/?${encodeURIComponent(steamUrl)}` },
    { name: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(steamUrl)}` },
  ];

  for (const cfg of proxyConfigs) {
    try {
      const res = await fetch(cfg.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.rwgrsn === -2) throw new Error('PRIVATE_INVENTORY');
      if (data.assets !== undefined || data.success !== undefined) {
        console.log(`[${cfg.name}] success`);
        return data;
      }
    } catch (e) {
      if (e.message === 'PRIVATE_INVENTORY') throw e;
      errors.push(`${cfg.name}: ${e.message}`);
      console.warn(`[${cfg.name}] failed:`, e.message);
    }
  }

  // 全部失败
  throw new Error(`CORS_ALL_FAILED: ${errors.slice(0, 3).join(' | ')}`);
}

// ── Load Inventory (API Key mode) ───────────────────────────────
async function loadInventory() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  const steamId64 = extractSteamId64(document.getElementById('steamIdInput').value);
  const appId = document.getElementById('appIdInput').value.trim() || '730';
  const ctxId = getContextId(appId);

  if (!apiKey) { showToast('请输入 Steam API Key'); return; }
  if (!steamId64) { showToast('请输入有效的 SteamID64（17位数字）'); return; }

  state.apiKey = apiKey;
  state.steamId = steamId64;
  state.appId = appId;
  state.mode = 'apikey';

  showInventorySection();
  showLoading();

  // Use public inventory endpoint (API Key not needed for inventory read, and avoids CORS)
  // The official API endpoint: ISteamInventory — only for item definitions, not full inventory
  // We use the community inventory endpoint (same as public mode, works for any public inventory)
  await fetchAndRenderInventory(steamId64, appId, ctxId, apiKey);
}

// ── Load Inventory (Public mode) ────────────────────────────────
async function loadPublicInventory() {
  const raw = document.getElementById('publicSteamIdInput').value.trim();
  const steamId64 = extractSteamId64(raw);
  const appId = _publicAppId;
  const ctxId = getContextId(appId);

  if (!steamId64) {
    showToast('请输入有效的 SteamID64（17位数字）');
    return;
  }

  state.steamId = steamId64;
  state.appId = appId;
  state.mode = 'public';

  showInventorySection();
  showLoading();

  await fetchAndRenderInventory(steamId64, appId, ctxId);
}

function getContextId(appId) {
  // CS2(730), Dota2(570), TF2(440) → context 2
  // Rust(252490) → context 2
  return 2;
}

// ── Core Fetch & Render ──────────────────────────────────────────
async function fetchAndRenderInventory(steamId64, appId, ctxId, apiKey) {
  try {
    // 1. Fetch player summary (for avatar/name) — use Steam API if key provided
    let playerInfo = null;
    if (apiKey) {
      try {
        playerInfo = await fetchPlayerSummary(steamId64, apiKey);
      } catch (e) {
        console.warn('Player summary failed:', e);
      }
    }

    // 2. Fetch inventory
    let data;
    try {
      data = await fetchSteamInventory(steamId64, appId, ctxId);
    } catch (e) {
      if (e.message === 'PRIVATE_INVENTORY') {
        showError('库存设为私密', '该账户的库存未公开。\n\n请在 Steam 客户端中：\n个人资料 → 编辑个人资料 → 隐私设置\n将「游戏详细信息」和「库存」设为公开。');
        return;
      }
      const isCorsErr = e.message.includes('CORS_ALL_FAILED') || e.message.includes('Failed to fetch') || e.message.includes('NetworkError');
      if (isCorsErr) {
        showError(
          '网络请求失败',
          '代理服务暂时无法连接 Steam，可能是网络问题或 Steam 限速。\n\n建议稍后重试，或检查网络连接。',
          false
        );
      } else {
        showError('无法加载库存', `可能原因：库存未设为公开、Steam 服务暂时不可用。\n${e.message}`);
      }
      return;
    }

    if (!data || data.success === false) {
      showError('库存加载失败', '该账户的库存可能设为私密，或该 SteamID 不存在。\n请确认：Steam 个人资料 → 隐私设置 → 游戏详情/库存设为公开');
      return;
    }

    const assets = data.assets || [];
    const descriptions = data.descriptions || [];

    // total_inventory_count 为 0 且 rwgrsn 为 -2 说明库存私密（兜底判断）
    if (assets.length === 0 && data.total_inventory_count === 0 && data.rwgrsn === -2) {
      showError('库存设为私密', '该账户的库存未公开。\n\n请在 Steam 客户端中：\n个人资料 → 编辑个人资料 → 隐私设置\n将「游戏详细信息」和「库存」设为公开。');
      return;
    }

    if (assets.length === 0) {
      updateUserInfo(playerInfo, steamId64, appId, 0);
      hideLoading();
      document.getElementById('emptyState').style.display = 'block';
      return;
    }

    // Build item map
    const descMap = {};
    descriptions.forEach(d => {
      descMap[`${d.classid}_${d.instanceid}`] = d;
    });

    // Merge assets + descriptions, aggregate duplicates
    const itemMap = {};
    assets.forEach(asset => {
      const key = `${asset.classid}_${asset.instanceid}`;
      const desc = descMap[key] || {};
      if (itemMap[key]) {
        itemMap[key].amount += parseInt(asset.amount || 1);
      } else {
        itemMap[key] = {
          ...desc,
          assetid: asset.assetid,
          amount: parseInt(asset.amount || 1),
          appid: asset.appid,
          contextid: asset.contextid,
          classid: asset.classid,
          instanceid: asset.instanceid,
        };
      }
    });

    state.allItems = Object.values(itemMap);
    state.filteredItems = [...state.allItems];
    state.displayCount = state.PAGE_SIZE;

    updateUserInfo(playerInfo, steamId64, appId, state.allItems.length);
    hideLoading();
    renderItems();

  } catch (e) {
    showError('发生错误', e.message);
  }
}

async function fetchPlayerSummary(steamId64, apiKey) {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId64}`;
  const data = await fetchWithProxy(url);
  const players = data?.response?.players;
  if (players && players.length > 0) return players[0];
  return null;
}

// ── Render ───────────────────────────────────────────────────────
function renderItems() {
  const grid = document.getElementById('itemsGrid');
  const list = document.getElementById('itemsList');
  const items = state.filteredItems.slice(0, state.displayCount);

  if (state.filteredItems.length === 0) {
    grid.innerHTML = '';
    list.innerHTML = '';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('loadMoreArea').style.display = 'none';
    return;
  }
  document.getElementById('emptyState').style.display = 'none';

  if (state.view === 'grid') {
    grid.style.display = 'grid';
    list.style.display = 'none';
    grid.innerHTML = items.map(renderGridCard).join('');
  } else {
    grid.style.display = 'none';
    list.style.display = 'flex';
    list.innerHTML = items.map(renderListRow).join('');
  }

  document.getElementById('loadMoreArea').style.display =
    state.filteredItems.length > state.displayCount ? 'block' : 'none';
}

function getRarityClass(tags) {
  if (!tags) return '';
  const rarity = tags.find(t => t.category === 'Rarity');
  if (!rarity) return '';
  const n = rarity.internal_name?.toLowerCase() || '';
  if (n.includes('common'))    return 'rarity-consumer';
  if (n.includes('uncommon'))  return 'rarity-industrial';
  if (n.includes('rare'))      return 'rarity-milspec';
  if (n.includes('mythical'))  return 'rarity-restricted';
  if (n.includes('legendary')) return 'rarity-classified';
  if (n.includes('ancient'))   return 'rarity-covert';
  if (n.includes('immortal') || n.includes('extraordinary') || n.includes('contraband'))
    return 'rarity-extraordinary';
  // CS2 tag names
  const ln = rarity.localized_tag_name?.toLowerCase() || '';
  if (ln.includes('消费级') || ln.includes('consumer'))      return 'rarity-consumer';
  if (ln.includes('工业级') || ln.includes('industrial'))    return 'rarity-industrial';
  if (ln.includes('军规') || ln.includes('mil-spec'))        return 'rarity-milspec';
  if (ln.includes('受限') || ln.includes('restricted'))      return 'rarity-restricted';
  if (ln.includes('保密') || ln.includes('classified'))      return 'rarity-classified';
  if (ln.includes('隐秘') || ln.includes('covert'))          return 'rarity-covert';
  if (ln.includes('非凡') || ln.includes('extraordinary'))   return 'rarity-extraordinary';
  return '';
}

function getRarityLabel(tags) {
  if (!tags) return '';
  const rarity = tags.find(t => t.category === 'Rarity');
  return rarity ? rarity.localized_tag_name || rarity.name || '' : '';
}

function getItemType(tags) {
  if (!tags) return '';
  const type = tags.find(t => t.category === 'Type');
  return type ? type.localized_tag_name || type.name || '' : '';
}

function getItemImage(icon_url) {
  if (!icon_url) return '';
  return `https://community.fastly.steamstatic.com/economy/image/${icon_url}/128fx128f`;
}

function isMarketable(item) {
  return item.marketable === 1 || item.marketable === true;
}

function isTradable(item) {
  return item.tradable === 1 || item.tradable === true;
}

function renderGridCard(item) {
  const rarityClass = getRarityClass(item.tags);
  const rarityLabel = getRarityLabel(item.tags);
  const itemType = getItemType(item.tags);
  const imgUrl = getItemImage(item.icon_url);
  const name = item.name || item.market_name || '未知物品';
  const count = item.amount > 1 ? `<div class="item-count-badge">x${item.amount}</div>` : '';
  const tradable = isTradable(item)
    ? '<div class="item-tradable-badge">可交易</div>' : '';

  return `
    <div class="item-card ${rarityClass}" onclick="openItemDetail('${item.classid}_${item.instanceid}')">
      <div class="item-image-wrap">
        ${imgUrl ? `<img src="${imgUrl}" alt="${escHtml(name)}" loading="lazy" onerror="this.style.display='none'"/>` : '<span style="font-size:32px">📦</span>'}
        ${count}
        ${tradable}
      </div>
      <div class="item-name" title="${escHtml(name)}">${escHtml(name)}</div>
      <div class="item-type">${escHtml(itemType)}</div>
      ${rarityLabel ? `<span class="item-rarity-tag ${rarityClass}" style="background:rgba(255,255,255,0.06)">${escHtml(rarityLabel)}</span>` : ''}
    </div>`;
}

function renderListRow(item) {
  const rarityClass = getRarityClass(item.tags);
  const rarityLabel = getRarityLabel(item.tags);
  const itemType = getItemType(item.tags);
  const imgUrl = getItemImage(item.icon_url);
  const name = item.name || item.market_name || '未知物品';
  const tradableText = isTradable(item)
    ? '<span style="color:var(--success)">✓ 可交易</span>'
    : '<span style="color:var(--text3)">✗ 不可交易</span>';

  return `
    <div class="item-list-row" onclick="openItemDetail('${item.classid}_${item.instanceid}')">
      ${imgUrl
        ? `<img class="item-list-img" src="${imgUrl}" alt="${escHtml(name)}" loading="lazy" onerror="this.src=''">`
        : '<div class="item-list-img" style="display:flex;align-items:center;justify-content:center;font-size:24px">📦</div>'}
      <div class="item-list-info">
        <div class="item-list-name">${escHtml(name)}</div>
        <div class="item-list-sub">${escHtml(itemType)}${item.amount > 1 ? ` · 数量: ${item.amount}` : ''}</div>
      </div>
      <div class="item-list-right">
        <div class="item-list-rarity ${rarityClass}">${escHtml(rarityLabel)}</div>
        <div class="item-list-tradable">${tradableText}</div>
      </div>
    </div>`;
}

// ── Item Detail Modal ────────────────────────────────────────────
function openItemDetail(key) {
  const item = state.allItems.find(i => `${i.classid}_${i.instanceid}` === key);
  if (!item) return;
  state.currentItem = item;

  const name = item.name || item.market_name || '未知物品';
  const imgUrl = getItemImage(item.icon_url);
  const rarityClass = getRarityClass(item.tags);
  const rarityLabel = getRarityLabel(item.tags);
  const itemType = getItemType(item.tags);
  const desc = item.descriptions?.map(d => d.value).join(' ') || '';
  const marketUrl = item.market_name
    ? `https://steamcommunity.com/market/listings/${item.appid || state.appId}/${encodeURIComponent(item.market_name)}`
    : null;

  const content = `
    ${imgUrl ? `<img class="modal-item-img" src="${imgUrl}" alt="${escHtml(name)}" onerror="this.style.display='none'"/>` : ''}
    <div class="modal-item-name">${escHtml(name)}</div>
    <div class="modal-item-type ${rarityClass}">${escHtml(itemType)} ${rarityLabel ? '· ' + escHtml(rarityLabel) : ''}</div>
    <div class="modal-badges">
      ${isTradable(item) ? '<span class="badge badge-tradable">✓ 可交易</span>' : '<span class="badge badge-not-tradable">✗ 不可交易</span>'}
      ${isMarketable(item) ? '<span class="badge" style="background:rgba(102,192,244,0.12);color:var(--accent)">可上架</span>' : ''}
      ${item.amount > 1 ? `<span class="badge">x${item.amount}</span>` : ''}
    </div>
    ${desc.trim() ? `<div class="modal-desc">${escHtml(desc.trim().substring(0, 300))}${desc.length > 300 ? '...' : ''}</div>` : ''}
    <div class="modal-actions">
      ${marketUrl ? `<a href="${marketUrl}" target="_blank" class="btn-secondary" style="flex:1;justify-content:center;text-decoration:none">Steam 市场</a>` : ''}
      <button class="btn-secondary" onclick="copyToClipboard('${escHtml(name)}')">复制名称</button>
    </div>`;

  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`已复制: ${text}`);
  });
}

// ── Filtering ────────────────────────────────────────────────────
function filterItems() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const rarity = document.getElementById('rarityFilter').value;
  const type = document.getElementById('typeFilter').value;
  const sort = document.getElementById('sortFilter').value;

  state.filteredItems = state.allItems.filter(item => {
    const name = (item.name || item.market_name || '').toLowerCase();
    const rarityLabel = getRarityLabel(item.tags);
    const itemType = getItemType(item.tags);

    if (q && !name.includes(q)) return false;
    if (rarity && !rarityLabel.includes(rarity)) return false;
    if (type && !itemType.includes(type)) return false;
    return true;
  });

  // Sort
  state.filteredItems.sort((a, b) => {
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'rarity') {
      const order = ['consumer','industrial','milspec','restricted','classified','covert','extraordinary'];
      const ra = order.indexOf(getRarityClass(a.tags).replace('rarity-',''));
      const rb = order.indexOf(getRarityClass(b.tags).replace('rarity-',''));
      return rb - ra;
    }
    if (sort === 'type') return (getItemType(a.tags) || '').localeCompare(getItemType(b.tags) || '');
    return 0;
  });

  state.displayCount = state.PAGE_SIZE;

  // Update stats
  document.getElementById('totalCount').textContent = state.filteredItems.length;

  renderItems();
}

function loadMore() {
  state.displayCount += state.PAGE_SIZE;
  renderItems();
}

// ── View ─────────────────────────────────────────────────────────
function setView(v, btn) {
  state.view = v;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderItems();
}

// ── UI State helpers ─────────────────────────────────────────────
function showInventorySection() {
  document.getElementById('heroSection').style.display = 'none';
  document.getElementById('inventorySection').style.display = 'block';
}

function resetView() {
  document.getElementById('heroSection').style.display = '';
  document.getElementById('inventorySection').style.display = 'none';
  document.getElementById('itemsGrid').innerHTML = '';
  document.getElementById('itemsList').innerHTML = '';
  state.allItems = [];
  state.filteredItems = [];
  hideLoading();
  document.getElementById('errorState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
}

function showLoading() {
  document.getElementById('loadingState').style.display = 'block';
  document.getElementById('errorState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('itemsGrid').innerHTML = '';
  document.getElementById('itemsList').innerHTML = '';
  document.getElementById('loadMoreArea').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loadingState').style.display = 'none';
}

function showError(title, msg, showHelp = false) {
  hideLoading();
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent = msg;
  const helpBtn = document.getElementById('errorHelpBtn');
  if (helpBtn) helpBtn.style.display = showHelp ? 'inline-flex' : 'none';
}

function updateUserInfo(playerInfo, steamId64, appId, count) {
  if (playerInfo) {
    document.getElementById('userName').textContent = playerInfo.personaname || steamId64;
    const avatar = playerInfo.avatarmedium || playerInfo.avatar || '';
    const avatarEl = document.getElementById('userAvatar');
    if (avatar) {
      avatarEl.src = avatar;
      avatarEl.style.display = 'block';
    } else {
      avatarEl.style.display = 'none';
    }
  } else {
    document.getElementById('userName').textContent = `SteamID: ${steamId64}`;
    document.getElementById('userAvatar').style.display = 'none';
  }
  const gameNames = { '730': 'CS2', '570': 'Dota 2', '440': 'TF2', '252490': 'Rust' };
  document.getElementById('userStatus').textContent = `${gameNames[appId] || `AppID ${appId}`} 库存`;
  document.getElementById('totalCount').textContent = count;
}

async function refreshInventory() {
  showLoading();
  const appId = state.appId || '730';
  const ctxId = getContextId(appId);
  const apiKey = state.mode === 'apikey' ? state.apiKey : undefined;
  await fetchAndRenderInventory(state.steamId, appId, ctxId, apiKey);
  showToast('库存已刷新');
}

// ── Escape HTML ──────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Keyboard shortcuts ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('corsHelpOverlay').classList.remove('open');
  }
});

// ── CORS Help Modal ──────────────────────────────────────────────
function showCorsHelp() {
  document.getElementById('corsHelpOverlay').classList.add('open');
}

function closeCorsHelp(e) {
  if (e && e.target !== document.getElementById('corsHelpOverlay')) return;
  document.getElementById('corsHelpOverlay').classList.remove('open');
}
