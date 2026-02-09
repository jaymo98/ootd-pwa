/* app.js */

const $ = (id) => document.getElementById(id);

const DB_NAME = "wardrobe_pwa_v4";
const DB_VERSION = 5;
const STORE_ITEMS = "items";
const STORE_OUTFITS = "outfits";

const CATEGORIES = [
  { key: "hat", label: "帽子" },
  { key: "scarf", label: "围巾" },
  { key: "top", label: "上衣" },
  { key: "pants", label: "裤子" },
  { key: "shoes", label: "鞋" }
];

const SLOTS = [
  { key: "hat", label: "帽子" },
  { key: "scarf", label: "围巾" },
  { key: "top", label: "上衣" },
  { key: "pants", label: "裤子" },
  { key: "shoes", label: "鞋" }
];

const SEASONS = [
  { key: "spring", label: "春" },
  { key: "summer", label: "夏" },
  { key: "autumn", label: "秋" },
  { key: "winter", label: "冬" }
];

// 分类 -> 标签下拉（可继续扩充）
const TAG_SUGGEST = {
  hat: ["棒球帽", "贝雷帽", "渔夫帽", "毛线帽"],
  scarf: ["围巾", "披肩", "丝巾"],
  top: ["T恤", "衬衫", "针织衫", "卫衣", "毛衣", "夹克", "风衣", "大衣", "背心"],
  pants: ["牛仔裤", "西裤", "阔腿裤", "短裤", "半身裙", "连衣裙"],
  shoes: ["运动鞋", "帆布鞋", "乐福鞋", "短靴", "长靴", "高跟鞋", "凉鞋"]
};

/* =========================
   性能关键参数（你可按需调整）
   ========================= */

// 衣柜列表/选择器：缩略图尺寸（越小越省）
const THUMB_MAX_DIM = 520;   // 建议 420~620
const THUMB_QUALITY = 0.80;  // 建议 0.75~0.85

// 编辑大图：保留细节但不至于巨大
const FULL_MAX_DIM = 1400;   // 建议 1100~1600
const FULL_QUALITY = 0.84;   // 建议 0.80~0.88

// 衣柜：一次追加渲染多少张卡片（越小越省）
const CLOSET_BATCH_SIZE = 24;

// IntersectionObserver：提前多少像素开始加载
const LAZY_ROOT_MARGIN = "500px";

/* ========================= */

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

function nowISO() {
  return new Date().toISOString();
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function categoryLabel(key) {
  const c = CATEGORIES.find(x => x.key === key);
  return c ? c.label : key;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 1500);
}

function escapeHTML(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeStr(s) {
  return String(s || "").trim();
}

function normalizeLower(s) {
  return normalizeStr(s).toLowerCase();
}

function intersect(aSet, arr) {
  for (const x of arr) if (aSet.has(x)) return true;
  return false;
}

/* ---------- tag select + custom ---------- */

function buildTagOptions(categoryKey) {
  const base = TAG_SUGGEST[categoryKey] || [];
  return base.slice();
}

function fillTagSelect(selectEl, categoryKey, currentTag) {
  const opts = buildTagOptions(categoryKey);
  selectEl.innerHTML = "";

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "请选择标签";
  selectEl.appendChild(ph);

  for (const t of opts) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    selectEl.appendChild(o);
  }

  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "自定义…";
  selectEl.appendChild(custom);

  const tag = normalizeStr(currentTag);
  if (!tag) {
    selectEl.value = "";
    return { mode: "empty", customValue: "" };
  }
  if (opts.includes(tag)) {
    selectEl.value = tag;
    return { mode: "preset", customValue: "" };
  }
  selectEl.value = "__custom__";
  return { mode: "custom", customValue: tag };
}

function showCustomInput(inputEl, show) {
  inputEl.style.display = show ? "block" : "none";
  if (!show) inputEl.value = "";
}

function getTagFromControls(selectEl, inputEl) {
  const v = selectEl.value;
  if (!v) return "";
  if (v === "__custom__") return normalizeStr(inputEl.value);
  return normalizeStr(v);
}

/* ---------- filter dropdowns (sync from items) ---------- */

function fillSimpleSelect(selectEl, values, keepValue, emptyLabel = "全部") {
  const old = keepValue ?? selectEl.value ?? "";
  selectEl.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = emptyLabel;
  selectEl.appendChild(optAll);

  const uniq = Array.from(new Set(values.map(v => normalizeStr(v)).filter(Boolean)));
  uniq.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  for (const v of uniq) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selectEl.appendChild(o);
  }

  if (old && uniq.includes(old)) selectEl.value = old;
  else selectEl.value = "";
}

function updateFilterOptions() {
  const cat = $("filterCategory").value || "";

  const colors = items.map(it => normalizeItem(it).color).filter(Boolean);

  const tagBase = items
    .map(normalizeItem)
    .filter(it => (cat ? it.category === cat : true))
    .map(it => it.tag)
    .filter(Boolean);

  fillSimpleSelect($("filterColorSelect"), colors, $("filterColorSelect").value, "全部");
  fillSimpleSelect($("filterTagSelect"), tagBase, $("filterTagSelect").value, "全部");
}

/* ---------- image compress (two versions) ---------- */

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

async function imageToJpegBlob(img, maxDim, quality) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, nw, nh);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob;
}

async function fileToTwoCompressedBlobs(file) {
  const img = await fileToImage(file);
  const thumbBlob = await imageToJpegBlob(img, THUMB_MAX_DIM, THUMB_QUALITY);
  const fullBlob = await imageToJpegBlob(img, FULL_MAX_DIM, FULL_QUALITY);
  return { thumbBlob: thumbBlob || file, fullBlob: fullBlob || file };
}

async function blobToThumbBlob(srcBlob) {
  const img = await blobToImage(srcBlob);
  const thumbBlob = await imageToJpegBlob(img, THUMB_MAX_DIM, THUMB_QUALITY);
  return thumbBlob || srcBlob;
}

/* ---------- IndexedDB ---------- */

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;

      if (!d.objectStoreNames.contains(STORE_ITEMS)) {
        const s = d.createObjectStore(STORE_ITEMS, { keyPath: "id" });
        s.createIndex("category", "category", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
        s.createIndex("tag", "tag", { unique: false });
      } else {
        const s = req.transaction.objectStore(STORE_ITEMS);
        if (!s.indexNames.contains("tag")) s.createIndex("tag", "tag", { unique: false });
      }

      if (!d.objectStoreNames.contains(STORE_OUTFITS)) {
        const s = d.createObjectStore(STORE_OUTFITS, { keyPath: "id" });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  const t = db.transaction(storeName, mode);
  return t.objectStore(storeName);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const s = tx(storeName, "readonly");
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const s = tx(storeName, "readwrite");
    const req = s.put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const s = tx(storeName, "readwrite");
    const req = s.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function idbClear(storeName) {
  return new Promise((resolve, reject) => {
    const s = tx(storeName, "readwrite");
    const req = s.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- state ---------- */

let items = [];
let outfits = [];

let activeOutfit = { hat: null, scarf: null, top: null, pants: null, shoes: null };

let currentEditId = null;
let pickerSlotKey = null;

const seasonState = new Set();
const filterSeasonState = new Set();
const editSeasonState = new Set();

/* ---------- chips ---------- */

function renderSeasonChips(containerEl, stateSet) {
  containerEl.innerHTML = "";
  for (const s of SEASONS) {
    const div = document.createElement("div");
    div.className = "chip" + (stateSet.has(s.key) ? " active" : "");
    div.textContent = s.label;
    div.onclick = () => {
      if (stateSet.has(s.key)) stateSet.delete(s.key);
      else stateSet.add(s.key);
      renderSeasonChips(containerEl, stateSet);
      if (containerEl === $("filterSeasonChips")) renderCloset(); // 过滤季节点完就刷新
    };
    containerEl.appendChild(div);
  }
}

/* ---------- preview default empty ---------- */

function ensurePreviewEmpty() {
  const img = $("imgPreview");
  const empty = $("previewEmpty");
  const hasSrc = img.hasAttribute("src") && normalizeStr(img.getAttribute("src"));
  if (!hasSrc) {
    img.style.display = "none";
    empty.style.display = "grid";
  } else {
    img.style.display = "block";
    empty.style.display = "none";
  }
}

function resetPreview() {
  const img = $("imgPreview");
  img.style.display = "none";
  img.removeAttribute("src");
  ensurePreviewEmpty();
}

function setPreviewFromFile(file) {
  const img = $("imgPreview");
  const empty = $("previewEmpty");

  img.style.display = "none";
  empty.style.display = "grid";

  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    img.style.display = "block";
    empty.style.display = "none";
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    resetPreview();
    toast("图片加载失败");
  };
  img.setAttribute("src", url);
}

/* ---------- helpers ---------- */

function resetForm() {
  $("fileInput").value = "";
  $("category").value = "";
  $("color").value = "";

  seasonState.clear();
  renderSeasonChips($("seasonChips"), seasonState);

  fillTagSelect($("tagSelect"), "", "");
  showCustomInput($("tagCustom"), false);

  resetPreview();
}

function normalizeItem(it) {
  let seasons = Array.isArray(it.seasons) ? it.seasons.slice() : [];
  if (seasons.includes("all")) seasons = ["spring", "summer", "autumn", "winter"];
  seasons = seasons.filter(x => ["spring","summer","autumn","winter"].includes(x));

  const tag = normalizeStr(it.tag || "");
  const color = normalizeStr(it.color || "");
  const imageBlob = it.imageBlob;
  const imageThumbBlob = it.imageThumbBlob; // 新字段：缩略图
  return { ...it, seasons, tag, color, imageBlob, imageThumbBlob };
}

function getThumbBlob(it) {
  const n = normalizeItem(it);
  return n.imageThumbBlob || n.imageBlob;
}

/* ---------- filters ---------- */

function filterItems(all) {
  const cat = $("filterCategory").value || "";
  const fColor = normalizeLower($("filterColorSelect").value || "");
  const fTag = normalizeLower($("filterTagSelect").value || "");

  const seasonSelected = new Set(Array.from(filterSeasonState));

  return all.map(normalizeItem).filter(it => {
    if (cat && it.category !== cat) return false;

    if (seasonSelected.size > 0) {
      if (!it.seasons || it.seasons.length === 0) return false;
      if (!intersect(seasonSelected, it.seasons)) return false;
    }

    if (fColor) {
      if (normalizeLower(it.color) !== fColor) return false;
    }

    if (fTag) {
      if (normalizeLower(it.tag) !== fTag) return false;
    }

    return true;
  });
}

/* =========================
   懒加载：图片 + 分批渲染
   ========================= */

let imgObserver = null;
let closetSentinelObserver = null;

function ensureObservers() {
  if (!imgObserver) {
    imgObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        imgObserver.unobserve(img);
        lazyLoadImg(img);
      }
    }, {
      root: null,
      rootMargin: LAZY_ROOT_MARGIN,
      threshold: 0.01
    });
  }

  if (!closetSentinelObserver) {
    closetSentinelObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (closetRenderState && closetRenderState.hasMore()) {
          closetRenderState.appendNextBatch();
        }
      }
    }, {
      root: null,
      rootMargin: "900px",
      threshold: 0.01
    });
  }
}

function observeLazyImg(imgEl) {
  ensureObservers();
  imgObserver.observe(imgEl);
}

function lazyLoadImg(imgEl) {
  const itemId = imgEl.dataset.itemId || "";
  const kind = imgEl.dataset.kind || "thumb"; // thumb / full
  const it = items.find(x => x.id === itemId);
  if (!it) return;

  let blob = null;
  if (kind === "full") blob = normalizeItem(it).imageBlob;
  else blob = getThumbBlob(it);

  if (!blob) return;

  const url = URL.createObjectURL(blob);
  imgEl.loading = "lazy";
  imgEl.decoding = "async";
  imgEl.onload = () => URL.revokeObjectURL(url);
  imgEl.onerror = () => URL.revokeObjectURL(url);
  imgEl.src = url;
}

let closetRenderState = null;

function createClosetRenderState(gridEl, list) {
  let idx = 0;
  const sentinel = document.createElement("div");
  sentinel.style.height = "1px";
  sentinel.style.width = "1px";

  function clearGrid() {
    gridEl.innerHTML = "";
    gridEl.appendChild(sentinel);
  }

  function hasMore() {
    return idx < list.length;
  }

  function makeItemCard(it) {
    const card = document.createElement("div");
    card.className = "item";

    // img: 先不设 src，进入视口再加载
    const imgEl = document.createElement("img");
    imgEl.alt = "衣服";
    imgEl.dataset.itemId = it.id;
    imgEl.dataset.kind = "thumb";
    imgEl.style.background = "rgba(0,0,0,.03)";
    imgEl.removeAttribute("src");
    observeLazyImg(imgEl);

    const body = document.createElement("div");
    body.className = "item-body";

    const meta = document.createElement("div");
    meta.className = "meta";

    const bCat = document.createElement("span");
    bCat.className = "badge";
    bCat.textContent = categoryLabel(it.category);

    const bTag = document.createElement("span");
    bTag.className = "badge";
    bTag.textContent = it.tag || "—";

    const bColor = document.createElement("span");
    bColor.className = "badge";
    bColor.textContent = it.color || "—";

    const bSeason = document.createElement("span");
    bSeason.className = "badge";
    bSeason.textContent = (it.seasons || [])
      .map(k => SEASONS.find(x => x.key === k)?.label || k)
      .join(" / ") || "—";

    meta.appendChild(bCat);
    meta.appendChild(bTag);
    meta.appendChild(bColor);
    meta.appendChild(bSeason);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "加入搭配";
    btnAdd.onclick = () => {
      setOutfitSlot(it.category, it.id);
      toast("已加入搭配");
    };

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn ghost";
    btnEdit.textContent = "编辑";
    btnEdit.onclick = () => openEdit(it.id);

    actions.appendChild(btnAdd);
    actions.appendChild(btnEdit);

    body.appendChild(meta);
    body.appendChild(actions);

    card.appendChild(imgEl);
    card.appendChild(body);
    return card;
  }

  function appendNextBatch() {
    const end = Math.min(list.length, idx + CLOSET_BATCH_SIZE);
    const frag = document.createDocumentFragment();
    for (; idx < end; idx++) {
      frag.appendChild(makeItemCard(list[idx]));
    }
    gridEl.insertBefore(frag, sentinel);
    ensureObservers();
    closetSentinelObserver.observe(sentinel);
  }

  clearGrid();

  return {
    clearGrid,
    hasMore,
    appendNextBatch,
    sentinel
  };
}

/* ---------- closet render ---------- */

function renderCloset() {
  const grid = $("closetGrid");
  const list = filterItems(items).slice().sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  if (list.length === 0) {
    grid.innerHTML = `<div class="card" style="text-align:center; color: rgba(0,0,0,.45); font-weight:800;">
      空空的
    </div>`;
    closetRenderState = null;
    return;
  }

  ensureObservers();
  closetRenderState = createClosetRenderState(grid, list);
  closetRenderState.appendNextBatch();
}

/* ---------- slots ---------- */

function summarizeItem(it) {
  const s = normalizeItem(it);
  const seasonStr = (s.seasons || [])
    .map(k => SEASONS.find(x => x.key === k)?.label || k)
    .join("/") || "";
  const parts = [s.tag, s.color, seasonStr].filter(Boolean);
  return parts.join(" · ") || "—";
}

function renderSlots() {
  const container = $("slots");
  container.innerHTML = "";

  for (const s of SLOTS) {
    const it = items.find(x => x.id === activeOutfit[s.key]) || null;

    const row = document.createElement("div");
    row.className = "slot";

    const box = document.createElement("div");
    box.className = "slot-img";
    if (it) {
      const img = document.createElement("img");
      img.alt = "slot";
      img.dataset.itemId = it.id;
      img.dataset.kind = "thumb";
      img.removeAttribute("src");
      observeLazyImg(img);
      box.appendChild(img);
    } else {
      box.textContent = "空";
    }

    const right = document.createElement("div");
    right.className = "slot-right";

    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = s.label;

    const sub = document.createElement("div");
    sub.className = "slot-sub";
    sub.textContent = it ? summarizeItem(it) : "";

    const actions = document.createElement("div");
    actions.className = "slot-actions";

    const btnChoose = document.createElement("button");
    btnChoose.className = "btn ghost sm";
    btnChoose.textContent = "选择";
    btnChoose.onclick = () => openPickerForSlot(s.key);

    const btnClear = document.createElement("button");
    btnClear.className = "btn ghost sm";
    btnClear.textContent = "清除";
    btnClear.onclick = () => {
      activeOutfit[s.key] = null;
      renderSlots();
    };

    actions.appendChild(btnChoose);
    actions.appendChild(btnClear);

    right.appendChild(name);
    right.appendChild(sub);
    right.appendChild(actions);

    row.appendChild(box);
    row.appendChild(right);
    container.appendChild(row);
  }
}

function setOutfitSlot(slotKey, itemId) {
  activeOutfit[slotKey] = itemId;
  renderSlots();
}

function clearOutfit() {
  for (const s of SLOTS) activeOutfit[s.key] = null;
  renderSlots();
  toast("已清空");
}

/* ---------- picker modal（也做懒加载） ---------- */

function showMask(id) { $(id).classList.remove("hidden"); }
function hideMask(id) { $(id).classList.add("hidden"); }

function openPickerForSlot(slotKey) {
  pickerSlotKey = slotKey;

  const title = `${SLOTS.find(x => x.key === slotKey)?.label || "选择"}`;
  $("pickerTitle").textContent = title;

  const list = items
    .map(normalizeItem)
    .filter(it => it.category === slotKey)
    .sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  const grid = $("pickerGrid");
  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align:center; color: rgba(0,0,0,.45); font-weight:800;">
      这里还没有衣服
    </div>`;
    showMask("pickerMask");
    return;
  }

  const frag = document.createDocumentFragment();
  for (const it of list) {
    const card = document.createElement("div");
    card.className = "item";
    card.style.cursor = "pointer";

    const imgEl = document.createElement("img");
    imgEl.alt = "选择衣服";
    imgEl.dataset.itemId = it.id;
    imgEl.dataset.kind = "thumb";
    imgEl.style.background = "rgba(0,0,0,.03)";
    imgEl.removeAttribute("src");
    observeLazyImg(imgEl);

    const body = document.createElement("div");
    body.className = "item-body";
    body.innerHTML = `
      <div class="meta">
        <span class="badge">${escapeHTML(it.tag || "—")}</span>
        <span class="badge">${escapeHTML(it.color || "—")}</span>
      </div>
    `;

    card.onclick = () => {
      setOutfitSlot(pickerSlotKey, it.id);
      hideMask("pickerMask");
      toast("已选择");
    };

    card.appendChild(imgEl);
    card.appendChild(body);
    frag.appendChild(card);
  }

  grid.appendChild(frag);
  showMask("pickerMask");
}

/* ---------- edit modal（编辑用大图） ---------- */

async function openEdit(itemId) {
  const it0 = items.find(x => x.id === itemId);
  if (!it0) return;
  const it = normalizeItem(it0);

  currentEditId = itemId;

  // 编辑弹窗显示大图（full）
  const imgEl = $("editImg");
  imgEl.alt = "edit";
  imgEl.dataset.itemId = it.id;
  imgEl.dataset.kind = "full";
  imgEl.removeAttribute("src");
  // 直接加载（弹窗里立刻看见）
  lazyLoadImg(imgEl);

  $("editCategory").value = it.category;
  $("editColor").value = it.color || "";

  const r = fillTagSelect($("editTagSelect"), it.category, it.tag);
  if (r.mode === "custom") {
    showCustomInput($("editTagCustom"), true);
    $("editTagCustom").value = r.customValue;
  } else {
    showCustomInput($("editTagCustom"), false);
  }

  editSeasonState.clear();
  for (const s of (it.seasons || [])) editSeasonState.add(s);
  renderSeasonChips($("editSeasonChips"), editSeasonState);

  showMask("editMask");
}

async function saveEdit() {
  const it = items.find(x => x.id === currentEditId);
  if (!it) return;

  const category = $("editCategory").value;
  const color = normalizeStr($("editColor").value);
  const tag = getTagFromControls($("editTagSelect"), $("editTagCustom"));
  const seasons = Array.from(editSeasonState);

  if (!category) { toast("请选择分类"); return; }
  if (!color) { toast("请输入颜色"); return; }
  if (!tag) { toast("请输入标签"); return; }
  if (seasons.length === 0) { toast("请选择季节"); return; }

  it.category = category;
  it.color = color;
  it.tag = tag;
  it.seasons = seasons;

  await idbPut(STORE_ITEMS, it);

  // 若分类改了，槽位按分类严格匹配：不匹配的就清掉
  for (const s of SLOTS) {
    if (activeOutfit[s.key] === it.id && s.key !== it.category) {
      activeOutfit[s.key] = null;
    }
  }

  await reloadData();
  renderSlots();
  hideMask("editMask");
  toast("已保存");
}

async function deleteEdit() {
  const it = items.find(x => x.id === currentEditId);
  if (!it) return;
  if (!confirm("确定删除吗？")) return;

  await idbDelete(STORE_ITEMS, it.id);

  for (const s of SLOTS) {
    if (activeOutfit[s.key] === it.id) activeOutfit[s.key] = null;
  }

  await reloadData();
  renderSlots();
  hideMask("editMask");
  toast("已删除");
}

/* ---------- add item（存两份 blob：thumb/full） ---------- */

async function addItemFromForm() {
  const file = $("fileInput").files && $("fileInput").files[0];
  const category = $("category").value;
  const color = normalizeStr($("color").value);
  const tag = getTagFromControls($("tagSelect"), $("tagCustom"));
  const seasons = Array.from(seasonState);

  if (!file) { toast("请选择图片"); return; }
  if (!category) { toast("请选择分类"); return; }
  if (!color) { toast("请输入颜色"); return; }
  if (!tag) { toast("请输入标签"); return; }
  if (seasons.length === 0) { toast("请选择季节"); return; }

  const { thumbBlob, fullBlob } = await fileToTwoCompressedBlobs(file);

  const item = {
    id: uuid(),
    category,
    seasons,
    color,
    tag,
    createdAt: nowISO(),
    imageBlob: fullBlob,
    imageThumbBlob: thumbBlob
  };

  await idbPut(STORE_ITEMS, item);
  await reloadData(); // 会同步刷新过滤下拉 + 衣柜
  resetForm();
  toast("已保存");
}

/* ---------- outfits ---------- */

async function saveCurrentOutfit() {
  const name = normalizeStr($("outfitName").value);
  const hasAny = SLOTS.some(s => !!activeOutfit[s.key]);
  if (!hasAny) { toast("搭配是空的"); return; }

  const outfit = {
    id: uuid(),
    name: name || `搭配 ${new Date().toLocaleString()}`,
    createdAt: nowISO(),
    slots: { ...activeOutfit }
  };

  await idbPut(STORE_OUTFITS, outfit);
  $("outfitName").value = "";
  await reloadData();
  toast("已保存搭配");
}

function renderOutfitList() {
  const el = $("outfitList");
  const list = outfits.slice().sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  if (list.length === 0) {
    el.innerHTML = `<div style="color: rgba(0,0,0,.45); font-weight: 800; text-align:center;">还没有搭配</div>`;
    return;
  }

  el.innerHTML = "";
  for (const o of list) {
    const row = document.createElement("div");
    row.className = "list-item";

    const left = document.createElement("div");
    left.innerHTML = `<div class="name">${escapeHTML(o.name)}</div><div class="time">${formatTime(o.createdAt)}</div>`;

    const right = document.createElement("div");
    right.className = "row";

    const btnLoad = document.createElement("button");
    btnLoad.className = "btn ghost sm";
    btnLoad.textContent = "加载";
    btnLoad.onclick = () => {
      activeOutfit = { hat: null, scarf: null, top: null, pants: null, shoes: null, ...(o.slots || {}) };
      renderSlots();
      toast("已加载");
    };

    const btnDel = document.createElement("button");
    btnDel.className = "btn danger ghost sm";
    btnDel.textContent = "删除";
    btnDel.onclick = async () => {
      if (!confirm("确定删除这个搭配吗？")) return;
      await idbDelete(STORE_OUTFITS, o.id);
      await reloadData();
      toast("已删除");
    };

    right.appendChild(btnLoad);
    right.appendChild(btnDel);

    row.appendChild(left);
    row.appendChild(right);
    el.appendChild(row);
  }
}

/* ---------- clear all ---------- */

async function clearAllData() {
  if (!confirm("确定清空全部数据吗？")) return;
  await idbClear(STORE_ITEMS);
  await idbClear(STORE_OUTFITS);
  clearOutfit();
  await reloadData();
  toast("已清空");
}

/* ---------- 补齐老数据的缩略图（分批） ---------- */

let thumbBackfillRunning = false;

async function backfillThumbsInBatches() {
  if (thumbBackfillRunning) return;
  thumbBackfillRunning = true;

  try {
    // 分批处理，避免一次性压缩太多
    const pending = items
      .map(normalizeItem)
      .filter(it => it.imageBlob && !it.imageThumbBlob);

    // 没有需要补齐的
    if (pending.length === 0) return;

    // 每次处理少量，处理完就让 UI 有机会喘口气
    const BATCH = 4;
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      for (const it of slice) {
        try {
          const thumbBlob = await blobToThumbBlob(it.imageBlob);
          const raw = items.find(x => x.id === it.id);
          if (raw) {
            raw.imageThumbBlob = thumbBlob;
            await idbPut(STORE_ITEMS, raw);
          }
        } catch {
          // 忽略单条失败
        }
      }

      // 更新内存数据 + 刷新过滤（不强制重渲染衣柜，避免抖动）
      items = await idbGetAll(STORE_ITEMS);
      updateFilterOptions();

      // 让出主线程
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    thumbBackfillRunning = false;
  }
}

/* ---------- reload ---------- */

async function reloadData() {
  items = await idbGetAll(STORE_ITEMS);
  outfits = await idbGetAll(STORE_OUTFITS);

  updateFilterOptions();
  renderCloset();
  renderOutfitList();

  // 不阻塞 UI 的后台补齐缩略图
  backfillThumbsInBatches();
}

/* ---------- service worker ---------- */

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); } catch {}
}

/* ---------- events ---------- */

function bindEvents() {
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setPreviewFromFile(f);
    else resetPreview();
  });

  $("category").addEventListener("change", () => {
    const cat = $("category").value || "";
    const r = fillTagSelect($("tagSelect"), cat, "");
    showCustomInput($("tagCustom"), r.mode === "custom");
  });

  $("tagSelect").addEventListener("change", () => {
    const v = $("tagSelect").value;
    showCustomInput($("tagCustom"), v === "__custom__");
  });

  $("btnSaveItem").addEventListener("click", addItemFromForm);
  $("btnResetForm").addEventListener("click", () => { resetForm(); toast("已清空"); });

  $("filterCategory").addEventListener("change", () => {
    updateFilterOptions(); // 分类变动时，标签下拉框按分类联动
    renderCloset();
  });

  $("filterColorSelect").addEventListener("change", renderCloset);
  $("filterTagSelect").addEventListener("change", renderCloset);

  $("btnSaveOutfit").addEventListener("click", saveCurrentOutfit);
  $("btnClearAll").addEventListener("click", clearAllData);

  $("btnClearOutfit").addEventListener("click", clearOutfit);

  $("pickerClose").addEventListener("click", () => hideMask("pickerMask"));
  $("pickerMask").addEventListener("click", (e) => {
    if (e.target === $("pickerMask")) hideMask("pickerMask");
  });

  $("editClose").addEventListener("click", () => hideMask("editMask"));
  $("editMask").addEventListener("click", (e) => {
    if (e.target === $("editMask")) hideMask("editMask");
  });

  $("editCategory").addEventListener("change", () => {
    const cat = $("editCategory").value;
    const cur = getTagFromControls($("editTagSelect"), $("editTagCustom"));
    const r = fillTagSelect($("editTagSelect"), cat, cur);
    if (r.mode === "custom") {
      showCustomInput($("editTagCustom"), true);
      $("editTagCustom").value = r.customValue;
    } else {
      showCustomInput($("editTagCustom"), false);
    }
  });

  $("editTagSelect").addEventListener("change", () => {
    const v = $("editTagSelect").value;
    showCustomInput($("editTagCustom"), v === "__custom__");
  });

  $("btnEditSave").addEventListener("click", saveEdit);
  $("btnEditDelete").addEventListener("click", deleteEdit);
}

window.addEventListener("load", async () => {
  db = await openDB();
  await registerSW();

  renderSeasonChips($("seasonChips"), seasonState);
  renderSeasonChips($("filterSeasonChips"), filterSeasonState);
  renderSeasonChips($("editSeasonChips"), editSeasonState);

  fillTagSelect($("tagSelect"), "", "");
  showCustomInput($("tagCustom"), false);
  resetPreview();

  bindEvents();

  await reloadData();
  renderSlots();
});
