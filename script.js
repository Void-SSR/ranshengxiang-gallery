const content = document.querySelector('#content');
const viewTitle = document.querySelector('#viewTitle');
const viewEyebrow = document.querySelector('#viewEyebrow');
const viewDescription = document.querySelector('#viewDescription');
const viewer = document.querySelector('#viewer');
const viewerImage = document.querySelector('#viewerImage');
const viewerTitle = document.querySelector('#viewerTitle');
const viewerConcept = document.querySelector('#viewerConcept');
const toast = document.querySelector('#toast');
const actionDialog = document.querySelector('#actionDialog');
const actionForm = document.querySelector('#actionForm');
const actionTitle = document.querySelector('#actionTitle');
const actionDescription = document.querySelector('#actionDescription');
const actionInputWrap = document.querySelector('#actionInputWrap');
const actionInput = document.querySelector('#actionInput');
const actionConfirm = document.querySelector('#actionConfirm');
const toggleDetails = document.querySelector('#toggleDetails');
const preloadGate = document.querySelector('#preloadGate');
const preloadMessage = document.querySelector('#preloadMessage');
const preloadProgress = document.querySelector('#preloadProgress');
const preloadCount = document.querySelector('#preloadCount');
const STORAGE_KEY = 'ranshengxiang-gallery-state-v1';
const PREVIEW_VERSION = '20260722-hd';
const PREVIEW_CACHE = `ranshengxiang-previews-${PREVIEW_VERSION}`;
const PREVIEW_READY_KEY = 'ranshengxiang-previews-ready';
const ORIGINAL_VERSION = '20260722-originals';
const ORIGINAL_CACHE = `ranshengxiang-originals-${ORIGINAL_VERSION}`;
const ORIGINAL_READY_KEY = 'ranshengxiang-originals-ready';
const MEBIBYTE = 1024 * 1024;
const PREVIEW_SAFE_SPACE = 80 * MEBIBYTE;
const ORIGINAL_FULL_SAFE_SPACE = 350 * MEBIBYTE;
const ORIGINAL_PARTIAL_START = 150 * MEBIBYTE;
const ORIGINAL_SPACE_RESERVE = 100 * MEBIBYTE;
const ORIGINAL_PARTIAL_CAP = 100 * MEBIBYTE;
const ORIGINAL_AVERAGE_BYTES = Math.ceil((205 * MEBIBYTE) / 80);

let catalog = [];
let state = { selectedIds: [], groups: [] };
let currentView = 'A';
let activeGroupId = new URLSearchParams(location.search).get('group');
let screenMode = new URLSearchParams(location.search).get('screen');
if (!['mobile', 'desktop'].includes(screenMode)) screenMode = matchMedia('(min-width: 860px)').matches ? 'desktop' : 'mobile';
let detailsHidden = new URLSearchParams(location.search).get('details') === 'hidden';
let toastTimer;

const viewCopy = {
  A: ['A COLLECTION', 'A类方案', '优先呈现概念和设计完成度较高的方向。'],
  B: ['B COLLECTION', 'B类方案', '保留值得继续讨论、调整和升级的方向。'],
  C: ['C COLLECTION', 'C类方案', '用于扩展选择范围，观察不同视觉语言和表达可能。'],
  selected: ['PRESELECTION', '预选方案', '选择保存在当前手机或浏览器，不会改变方案原有的A、B、C类别。'],
  compare: ['COMPARISON', '对比方案', '可以建立多个对比组，每组加入2—6张方案并按数量自动排版。'],
};

function selected(id) { return state.selectedIds.includes(id); }
function item(id) { return catalog.find((entry) => entry.id === id); }
function previewSource(entry) { return `${entry.preview}?v=${PREVIEW_VERSION}`; }
function originalSource(entry) { return `assets/originals/${encodeURIComponent(entry.originalFilename)}?v=${ORIGINAL_VERSION}`; }
function activeGroup() { return state.groups.find((group) => group.id === activeGroupId) || state.groups[0] || null; }
function rememberActiveGroup(id) {
  activeGroupId = id || null;
  const url = new URL(location.href);
  if (activeGroupId) url.searchParams.set('group', activeGroupId);
  else url.searchParams.delete('group');
  history.replaceState(null, '', url);
}
function syncActiveGroup() {
  const group = activeGroup();
  if ((group?.id || null) !== activeGroupId) rememberActiveGroup(group?.id || null);
  return group;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.selectedIds) || !Array.isArray(saved.groups)) return { selectedIds: [], groups: [] };
    return {
      selectedIds: saved.selectedIds.filter((id) => typeof id === 'string'),
      groups: saved.groups
        .filter((group) => group && typeof group.id === 'string' && Array.isArray(group.itemIds))
        .map((group) => ({ id: group.id, name: String(group.name || '对比组').slice(0, 30), itemIds: group.itemIds.filter((id) => typeof id === 'string').slice(0, 6) })),
    };
  } catch {
    return { selectedIds: [], groups: [] };
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cacheVersionReady(key, version) {
  try { return localStorage.getItem(key) === version; } catch { return false; }
}

function markCacheVersionReady(key, version) {
  try { localStorage.setItem(key, version); } catch { /* Private mode may reject persistence. */ }
}

function clearCacheVersionReady(key) {
  try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

async function storageEstimate() {
  if (!navigator.storage?.estimate) return { supported: false, available: null, quota: null, usage: null };
  try {
    const estimate = await navigator.storage.estimate();
    const quota = Number(estimate.quota);
    const usage = Number(estimate.usage);
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) throw new Error('Invalid storage estimate');
    return { supported: true, quota, usage, available: Math.max(0, quota - usage) };
  } catch {
    return { supported: false, available: null, quota: null, usage: null };
  }
}

function localStorageTestMode() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null;
  const value = new URLSearchParams(location.search).get('storageTest');
  return ['low', 'partial', 'full'].includes(value) ? value : null;
}

function connectionAllowsBulkCache() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !['slow-2g', '2g'].includes(connection.effectiveType);
}

function previewCachePlan(estimate) {
  const testMode = localStorageTestMode();
  if (testMode === 'low') return { mode: 'priority', entries: catalog.filter((entry) => entry.category === 'A') };
  if (testMode === 'partial' || testMode === 'full') return { mode: 'full', entries: catalog };
  if (estimate.available !== null && estimate.available < PREVIEW_SAFE_SPACE) {
    return { mode: 'priority', entries: catalog.filter((entry) => entry.category === 'A') };
  }
  return { mode: 'full', entries: catalog };
}

function originalCachePlan(estimate) {
  const testMode = localStorageTestMode();
  if (testMode === 'low') return { mode: 'ondemand', budget: 0 };
  if (testMode === 'partial') return { mode: 'partial', budget: 48 * MEBIBYTE };
  if (testMode === 'full') return { mode: 'full', budget: Infinity };
  if (!connectionAllowsBulkCache()) return { mode: 'ondemand', budget: 0 };
  if (estimate.available === null || estimate.available >= ORIGINAL_FULL_SAFE_SPACE) {
    return { mode: 'full', budget: Infinity };
  }
  if (estimate.available >= ORIGINAL_PARTIAL_START) {
    return {
      mode: 'partial',
      budget: Math.min(ORIGINAL_PARTIAL_CAP, Math.max(0, estimate.available - ORIGINAL_SPACE_RESERVE)),
    };
  }
  return { mode: 'ondemand', budget: 0 };
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return Boolean(await navigator.storage.persist());
  } catch {
    return false;
  }
}

function armPersistentStorageRequest() {
  document.addEventListener('pointerdown', () => { requestPersistentStorage(); }, { once: true, capture: true });
}

async function cacheHealthy(cacheName, urls) {
  if (!('caches' in window) || !urls.length) return false;
  try {
    const cache = await caches.open(cacheName);
    const sentinels = urls.length === 1 ? urls : [urls[0], urls[urls.length - 1]];
    const matches = await Promise.all(sentinels.map((url) => cache.match(url)));
    return matches.every(Boolean);
  } catch {
    return false;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(350 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function preloadWithoutCache(urls) {
  let cursor = 0;
  let completed = 0;
  let failures = 0;

  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => { failures += 1; resolve(); };
        image.src = url;
      });
      completed += 1;
      updatePreloadProgress(completed, urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return failures === 0;
}

function updatePreloadProgress(done, total) {
  const percentage = total ? Math.round((done / total) * 100) : 100;
  preloadCount.textContent = String(done);
  preloadProgress.style.width = `${percentage}%`;
}

function hidePreloadGate(message = '高清方案已准备完成') {
  preloadMessage.textContent = message;
  preloadGate.classList.add('is-complete');
  setTimeout(() => {
    preloadGate.hidden = true;
  }, 420);
}

async function cachePreviewSet(plan) {
  const urls = plan.entries.map(previewSource);
  updatePreloadProgress(0, urls.length);
  preloadCount.nextElementSibling.textContent = `/ ${urls.length}`;

  if (plan.mode === 'full' && cacheVersionReady(PREVIEW_READY_KEY, PREVIEW_VERSION)) {
    if (await cacheHealthy(PREVIEW_CACHE, urls)) {
      updatePreloadProgress(urls.length, urls.length);
      return { complete: true, mode: plan.mode };
    }
    clearCacheVersionReady(PREVIEW_READY_KEY);
  }

  if (!('caches' in window)) {
    return { complete: await preloadWithoutCache(urls), mode: plan.mode };
  }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js?v=20260722-adaptive');
      await navigator.serviceWorker.ready;
    } catch {
      // Cache Storage still works as the first-load fallback.
    }
  }

  let cache;
  try {
    cache = await caches.open(PREVIEW_CACHE);
  } catch {
    return { complete: await preloadWithoutCache(urls), mode: plan.mode };
  }
  let cursor = 0;
  let completed = 0;
  let failures = 0;

  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      try {
        const cached = await cache.match(url);
        if (!cached) {
          const response = await fetchWithRetry(url, { cache: 'reload' });
          await cache.put(url, response.clone());
        }
      } catch {
        // A failed item can still load normally when it enters the viewport.
        failures += 1;
      }
      completed += 1;
      updatePreloadProgress(completed, urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  const complete = failures === 0;
  if (complete && plan.mode === 'full') markCacheVersionReady(PREVIEW_READY_KEY, PREVIEW_VERSION);
  return { complete, mode: plan.mode };
}

async function cacheOriginalSet(plan) {
  if (plan.mode === 'ondemand') return;
  const selectedEntries = state.selectedIds.map(item).filter(Boolean);
  const selectedIds = new Set(selectedEntries.map((entry) => entry.id));
  const orderedEntries = [
    ...selectedEntries,
    ...['A', 'B', 'C'].flatMap((category) => catalog.filter((entry) => entry.category === category && !selectedIds.has(entry.id))),
  ];
  const urls = orderedEntries.map(originalSource);

  if (plan.mode === 'full' && cacheVersionReady(ORIGINAL_READY_KEY, ORIGINAL_VERSION)) {
    if (await cacheHealthy(ORIGINAL_CACHE, urls)) return;
    clearCacheVersionReady(ORIGINAL_READY_KEY);
  }

  if (!('caches' in window)) {
    const fallbackLimit = plan.mode === 'partial'
      ? Math.max(1, Math.floor(plan.budget / ORIGINAL_AVERAGE_BYTES))
      : urls.length;
    for (const url of urls.slice(0, fallbackLimit)) {
      try {
        await fetch(url, { cache: 'force-cache', priority: 'low' });
      } catch {
        // Clicking the image will retry normally.
      }
    }
    return;
  }

  let cache;
  try {
    cache = await caches.open(ORIGINAL_CACHE);
  } catch {
    return;
  }
  let cursor = 0;
  let storageUnavailable = false;
  let failures = 0;
  let storedBytes = 0;

  async function worker() {
    while (cursor < urls.length && !storageUnavailable && storedBytes < plan.budget) {
      const url = urls[cursor];
      cursor += 1;
      try {
        const cached = await cache.match(url);
        if (cached) continue;
        const response = await fetchWithRetry(url, { cache: 'reload', priority: 'low' });
        const responseBytes = Number(response.headers.get('content-length')) || ORIGINAL_AVERAGE_BYTES;
        if (plan.mode === 'partial' && storedBytes + responseBytes > plan.budget) break;
        await cache.put(url, response.clone());
        storedBytes += responseBytes;
      } catch (error) {
        failures += 1;
        if (error?.name === 'QuotaExceededError') storageUnavailable = true;
      }
    }
  }

  await Promise.all([worker(), worker()]);
  if (plan.mode === 'full' && cursor >= urls.length && !failures && !storageUnavailable) {
    markCacheVersionReady(ORIGINAL_READY_KEY, ORIGINAL_VERSION);
  }
}

function scheduleOriginalCache(plan) {
  document.documentElement.dataset.originalCache = plan.mode;
  const start = () => cacheOriginalSet(plan).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}

function schemeTemplate(entry, options = {}) {
  const selectedState = selected(entry.id);
  const groupControls = options.withGroups ? groupPicker(entry) : '';
  return `
    <article class="scheme" data-id="${entry.id}">
      <div class="scheme__image" data-open="${entry.id}"><img loading="lazy" decoding="async" src="${previewSource(entry)}" alt="${entry.title}"></div>
      <div class="scheme__body">
        <div class="scheme__meta"><span>${entry.category}类方案</span><span>方案 ${entry.id}</span></div>
        <div class="scheme__title-row">
          <h3>${entry.title}</h3>
          <div class="proofs">${entry.proofs.map((proof) => `<span>${proof}</span>`).join('')}</div>
        </div>
        <p class="scheme__concept"><span>概念价值</span>${entry.concept}</p>
        <div class="scheme__actions">
          <button class="select-button ${selectedState ? 'is-selected' : ''}" data-select="${entry.id}">${selectedState ? '✓ 已预选' : '+ 预选'}</button>
        </div>
        ${groupControls}
      </div>
    </article>`;
}

function groupPicker(entry) {
  const group = activeGroup();
  const alreadyAdded = group?.itemIds.includes(entry.id);
  const label = !group
    ? '加入对比（自动建组）'
    : alreadyAdded
      ? `已在「${escapeHtml(group.name)}」`
      : `加入「${escapeHtml(group.name)}」`;
  return `
    <div class="selected-add-row">
      <button class="group-add" data-add-to-group="${entry.id}" ${alreadyAdded ? 'disabled' : ''}>${label}</button>
    </div>`;
}

function render() {
  syncActiveGroup();
  const copy = viewCopy[currentView];
  [viewEyebrow.textContent, viewTitle.textContent, viewDescription.textContent] = copy;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === currentView));
  if (['A','B','C'].includes(currentView)) renderCategory();
  if (currentView === 'selected') renderSelected();
  if (currentView === 'compare') renderCompare();
  updateCounts();
  bindCommon();
}

function renderCategory() {
  const entries = catalog.filter((entry) => entry.category === currentView);
  content.innerHTML = entries.map((entry) => schemeTemplate(entry)).join('');
}

function renderSelected() {
  const entries = state.selectedIds.map(item).filter(Boolean);
  const group = activeGroup();
  const groupStatus = group
    ? `<label class="active-group"><span>当前加入的对比组</span><select data-active-group aria-label="当前对比组">${state.groups.map((entry) => `<option value="${entry.id}" ${entry.id === group.id ? 'selected' : ''}>${escapeHtml(entry.name)} · ${entry.itemIds.length}/6</option>`).join('')}</select></label>
       <button class="group-add group-add--secondary" data-create-group>+ 建立新的对比组</button>`
    : `<div class="auto-group-note"><strong>不用提前建组</strong><span>第一次点击图片下方的“加入对比”，系统会自动建立“对比组 1”。</span></div>`;
  const tools = `
    <div class="selected-tools">
      <h3>把喜欢的方案放在一起比较</h3>
      <p>选择只保存在当前手机或浏览器。每组可放2—6张，并在手机同一屏快速比较。</p>
      ${groupStatus}
      ${entries.length ? '<div class="selected-add-row"><button class="group-add" data-copy-results>复制我的预选结果</button></div>' : ''}
    </div>`;
  content.innerHTML = tools + (entries.length
    ? entries.map((entry) => schemeTemplate(entry, { withGroups: true })).join('')
    : '<div class="empty"><h3>还没有预选方案</h3><p>回到A、B或C类，点击图片下方的“预选”。</p></div>');
  content.querySelector('[data-create-group]')?.addEventListener('click', createGroup);
  content.querySelector('[data-copy-results]')?.addEventListener('click', copyResults);
  content.querySelector('[data-active-group]')?.addEventListener('change', (event) => {
    rememberActiveGroup(event.target.value);
    render();
  });
  if (!entries.length) return;
  content.querySelectorAll('[data-add-to-group]').forEach((button) => button.addEventListener('click', () => addToGroup(button.dataset.addToGroup)));
}

function renderCompare() {
  const tools = `<div class="selected-tools"><h3>同屏对比库</h3><p>每组2—6张图片会按手机屏幕自动纵向或分栏排布，方便快速比较构图、配色和价值表达。</p>${state.groups.length ? '<button class="group-add group-add--secondary" data-create-group>+ 建立新的对比组</button>' : ''}</div>`;
  if (!state.groups.length) {
    content.innerHTML = `${tools}<div class="empty"><h3>还没有对比组</h3><p>前往“预选”，点击任意方案的“加入对比”，系统会自动建组。</p></div>`;
    return;
  }
  content.innerHTML = tools + state.groups.map((group) => comparisonTemplate(group)).join('');
  content.querySelector('[data-create-group]').addEventListener('click', createGroup);
  content.querySelectorAll('[data-delete-group]').forEach((button) => button.addEventListener('click', () => deleteGroup(button.dataset.deleteGroup)));
  content.querySelectorAll('[data-remove-from-group]').forEach((button) => button.addEventListener('click', () => {
    removeFromGroup(button.dataset.group, button.dataset.removeFromGroup);
  }));
}

function comparisonTemplate(group) {
  const entries = group.itemIds.map(item).filter(Boolean);
  const mobileColumns = entries.length === 6 ? 2 : 1;
  const mobileRows = entries.length === 6 ? 3 : Math.max(1, entries.length);
  const desktopColumns = Math.max(1, Math.min(3, entries.length));
  return `
    <section class="comparison">
      <div class="comparison__head">
        <div><h3>${escapeHtml(group.name)}</h3><p>${entries.length}/6 张${entries.length < 2 ? ' · 再加入一张即可开始比较' : ' · 已进入同屏对比'}</p></div>
        <button class="danger-button" data-delete-group="${group.id}">删除组</button>
      </div>
      ${entries.length ? `<div class="comparison__grid" style="--mobile-columns:${mobileColumns};--mobile-rows:${mobileRows};--desktop-columns:${desktopColumns}">${entries.map((entry) => `
        <article class="compare-item">
          <img loading="lazy" decoding="async" data-open="${entry.id}" src="${previewSource(entry)}" alt="${entry.title}">
          <div class="compare-item__copy"><strong>方案${entry.id}</strong><span>${entry.category}类</span></div>
          <button class="compare-item__remove" aria-label="移出方案${entry.id}" data-group="${group.id}" data-remove-from-group="${entry.id}">×</button>
        </article>`).join('')}</div>` : `<div class="empty"><p>从预选方案中加入图片。</p></div>`}
      ${entries.length ? '<p class="comparison__hint">点击任意图片可放大查看细节</p>' : ''}
    </section>`;
}

function bindCommon() {
  content.querySelectorAll('[data-open]').forEach((node) => node.addEventListener('click', () => openViewer(node.dataset.open)));
  content.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', () => toggleSelect(button.dataset.select)));
}

async function toggleSelect(id) {
  state.selectedIds = selected(id)
    ? state.selectedIds.filter((value) => value !== id)
    : [...state.selectedIds, id];
  saveLocalState();
  showToast(selected(id) ? '已加入预选' : '已取消预选');
  render();
}

async function createGroup() {
  const name = await askGroupName(`对比组 ${state.groups.length + 1}`);
  if (!name) return;
  state.groups.push({ id: `g${Date.now().toString(36)}`, name: name.slice(0, 30), itemIds: [] });
  saveLocalState();
  rememberActiveGroup(state.groups[state.groups.length - 1]?.id || null);
  showToast('已创建对比组');
  render();
}

async function addToGroup(itemId) {
  let group = activeGroup();
  if (!group) {
    group = { id: `g${Date.now().toString(36)}`, name: '对比组 1', itemIds: [] };
    state.groups.push(group);
    rememberActiveGroup(group.id);
  }
  if (group.itemIds.includes(itemId)) return showToast('这张图已经在本组中');
  if (group.itemIds.length >= 6) return showToast('每个对比组最多6张');
  group.itemIds.push(itemId);
  if (!state.selectedIds.includes(itemId)) state.selectedIds.push(itemId);
  saveLocalState();
  showToast('已加入对比组');
  render();
}

async function removeFromGroup(groupId, itemId) {
  const group = state.groups.find((entry) => entry.id === groupId);
  if (!group) return;
  group.itemIds = group.itemIds.filter((id) => id !== itemId);
  saveLocalState();
  showToast('已移出对比组');
  render();
}

async function deleteGroup(groupId) {
  if (!await askDeleteGroup()) return;
  state.groups = state.groups.filter((group) => group.id !== groupId);
  saveLocalState();
  if (activeGroupId === groupId) rememberActiveGroup(state.groups[0]?.id || null);
  showToast('对比组已删除');
  render();
}

function openActionDialog({ title, description, confirmText, inputValue = null }) {
  actionTitle.textContent = title;
  actionDescription.textContent = description;
  actionConfirm.textContent = confirmText;
  const hasInput = inputValue !== null;
  actionInputWrap.hidden = !hasInput;
  actionInput.value = hasInput ? inputValue : '';
  actionDialog.showModal();
  if (hasInput) requestAnimationFrame(() => actionInput.select());

  return new Promise((resolve) => {
    actionDialog.addEventListener('close', () => {
      if (actionDialog.returnValue !== 'confirm') return resolve(null);
      resolve(hasInput ? actionInput.value.trim() : true);
    }, { once: true });
  });
}

function askGroupName(defaultName) {
  return openActionDialog({
    title: '新建对比组',
    description: '给这一组起一个便于沟通的名称，之后还可以继续建立其他组。',
    confirmText: '创建对比组',
    inputValue: defaultName,
  });
}

function askDeleteGroup() {
  return openActionDialog({
    title: '删除这个对比组？',
    description: '只删除本组，不会影响已经预选的方案。',
    confirmText: '确认删除',
  });
}

function resultText() {
  const sections = ['A', 'B', 'C'].map((category) => {
    const ids = state.selectedIds.filter((id) => item(id)?.category === category);
    return ids.length ? `${category}类：${ids.map((id) => `方案${id}`).join('、')}` : '';
  }).filter(Boolean);
  const groups = state.groups
    .filter((group) => group.itemIds.length)
    .map((group) => `${group.name}：${group.itemIds.map((id) => `方案${id}`).join('、')}`);
  return [
    '苒盛香 · 祖传牛舌饼包装策略',
    `我的预选（${state.selectedIds.length}张）`,
    ...sections,
    ...(groups.length ? ['', '我的对比组', ...groups] : []),
  ].join('\n');
}

async function copyResults() {
  const text = resultText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  showToast('预选结果已复制，可以发到微信');
}

function openViewer(id) {
  const entry = item(id);
  if (!entry) return;
  viewerImage.src = originalSource(entry);
  viewerTitle.textContent = `${entry.title} · 方案${entry.id}`;
  viewerConcept.textContent = entry.concept;
  viewer.showModal();
}

function setView(view) {
  currentView = view;
  render();
  const target = view === 'compare' && state.groups.length
    ? content.querySelector('.comparison')
    : document.querySelector('main');
  requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function setScreenMode(mode, navigate = true) {
  screenMode = mode;
  document.body.dataset.layout = mode;
  document.querySelectorAll('[data-screen-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.screenMode === mode));
  const url = new URL(location.href);
  url.searchParams.set('screen', mode);
  history.replaceState(null, '', url);
  if (navigate) setView('A');
}

function setDetailsHidden(hidden) {
  detailsHidden = hidden;
  document.body.classList.toggle('details-hidden', hidden);
  toggleDetails.textContent = hidden ? '显示文字' : '隐藏文字';
  toggleDetails.setAttribute('aria-pressed', String(hidden));
  const url = new URL(location.href);
  if (hidden) url.searchParams.set('details', 'hidden');
  else url.searchParams.delete('details');
  history.replaceState(null, '', url);
}

function updateCounts() {
  ['A','B','C'].forEach((category) => document.querySelector(`#count${category}`).textContent = catalog.filter((item) => item.category === category).length);
  document.querySelector('#countSelected').textContent = state.selectedIds.length;
  document.querySelector('#countGroups').textContent = state.groups.length;
  document.querySelector('#bottomSelected').textContent = state.selectedIds.length;
  document.querySelector('#bottomGroups').textContent = state.groups.length;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

async function init() {
  setScreenMode(screenMode, false);
  setDetailsHidden(detailsHidden);
  armPersistentStorageRequest();
  catalog = await fetch('./catalog.json', { cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error('方案目录加载失败');
    return response.json();
  });
  const initialStorage = await storageEstimate();
  const previewPlan = previewCachePlan(initialStorage);
  document.documentElement.dataset.previewCache = previewPlan.mode;
  const previewResult = await cachePreviewSet(previewPlan);
  state = loadLocalState();
  render();
  hidePreloadGate(previewResult.complete
    ? (previewResult.mode === 'full' ? '高清方案已准备完成' : '重点高清方案已准备完成')
    : '部分图片将在浏览时继续加载');
  const storageAfterPreview = await storageEstimate();
  scheduleOriginalCache(originalCachePlan(storageAfterPreview));
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-screen-mode]').forEach((button) => button.addEventListener('click', () => setScreenMode(button.dataset.screenMode)));
toggleDetails.addEventListener('click', () => setDetailsHidden(!detailsHidden));
document.querySelector('.viewer__close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (event) => { if (event.target === viewer) viewer.close(); });
actionForm.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'confirm' || actionInputWrap.hidden || actionInput.value.trim()) return;
  event.preventDefault();
  showToast('请输入对比组名称');
  actionInput.focus();
});
actionDialog.addEventListener('click', (event) => { if (event.target === actionDialog) actionDialog.close('cancel'); });

init().catch(() => {
  hidePreloadGate('部分图片将在浏览时继续加载');
  showToast('部分图片加载较慢，浏览时将自动补齐');
});
