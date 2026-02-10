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

const MULTI_SLOTS = new Set(["top", "pants"]); 

const SEASONS = [
  { key: "spring", label: "春" },
  { key: "summer", label: "夏" },
  { key: "autumn", label: "秋" },
  { key: "winter", label: "冬" }
];

const TAG_SUGGEST = {
  hat: ["棒球帽", "贝雷帽", "渔夫帽", "毛线帽"],
  scarf: ["围巾", "披肩", "丝巾"],
  top: ["T恤", "衬衫", "针织衫", "卫衣", "毛衣", "夹克", "风衣", "大衣", "背心"],
  pants: ["牛仔裤", "西裤", "阔腿裤", "短裤", "半身裙", "连衣裙"],
  shoes: ["运动鞋", "帆布鞋", "乐福鞋", "短靴", "长靴", "高跟鞋", "凉鞋"]
};

/* =========================
   性能关键参数
   ========================= */

// 缩略图（衣柜/选择器/当前搭配）
const THUMB_MAX_DIM = 520;
const THUMB_QUALITY = 0.80;

// 大图（编辑弹窗）
const FULL_MAX_DIM = 1400;
const FULL_QUALITY = 0.84;

// 衣柜分批渲染
const CLOSET_BATCH_SIZE = 24;

// 图片懒加载提前量
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

// ✅ top/pants 是数组
let activeOutfit = normalizeOutfitSlots({});

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
      if (containerEl === $("filterSeasonChips")) renderCloset();
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
  const imageThumbBlob = it.imageThumbBlob;
  return { ...it, seasons, tag, color, imageBlob, imageThumbBlob };
}

function getThumbBlob(it) {
  const n = normalizeItem(it);
  return n.imageThumbBlob || n.imageBlob;
}

/* ---------- outfit multi-slot normalize ---------- */

function asIdArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === "string") return [v];
  return [];
}

function uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x);
    if (!k) continue;
    if (s.has(k)) continue;
    s.add(k);
    out.push(k);
  }
  return out;
}

function normalizeOutfitSlots(slots) {
  const s = slots || {};
  return {
    hat: s.hat || null,
    scarf: s.scarf || null,
    shoes: s.shoes || null,
    top: uniq(asIdArray(s.top)),
    pants: uniq(asIdArray(s.pants))
  };
}

function removeItemFromOutfitEverywhere(itemId) {
  const id = String(itemId);
  for (const slot of SLOTS) {
    if (MULTI_SLOTS.has(slot.key)) {
      activeOutfit[slot.key] = (activeOutfit[slot.key] || []).filter(x => x !== id);
    } else {
      if (activeOutfit[slot.key] === id) activeOutfit[slot.key] = null;
    }
  }
}

function purgeOutfitByCategoryRule(itemId, newCategory) {
  const id = String(itemId);
  for (const slot of SLOTS) {
    const k = slot.key;
    if (k === newCategory) continue;
    if (MULTI_SLOTS.has(k)) {
      activeOutfit[k] = (activeOutfit[k] || []).filter(x => x !== id);
    } else {
      if (activeOutfit[k] === id) activeOutfit[k] = null;
    }
  }
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

/* ---------- slots（上衣/裤子多件） ---------- */

function summarizeOne(it) {
  const s = normalizeItem(it);
  const parts = [s.tag, s.color].filter(Boolean);
  return parts.join("·") || "—";
}

function summarizeMulti(ids) {
  const list = (ids || []).map(id => items.find(x => x.id === id)).filter(Boolean);
  if (list.length === 0) return "";
  const texts = list.map(summarizeOne);
  if (texts.length <= 2) return `${texts.length}件：${texts.join(" / ")}`;
  return `${texts.length}件：${texts.slice(0,2).join(" / ")} ...`;
}

function makeThumbWithRemove(itemId, onRemove) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.flex = "0 0 auto";
  wrap.style.width = "54px";
  wrap.style.height = "54px";
  wrap.style.borderRadius = "16px";
  wrap.style.overflow = "hidden";
  wrap.style.background = "rgba(0,0,0,.03)";

  const img = document.createElement("img");
  img.alt = "thumb";
  img.dataset.itemId = itemId;
  img.dataset.kind = "thumb";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.removeAttribute("src");
  observeLazyImg(img);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "×";
  btn.onclick = (e) => { e.stopPropagation(); onRemove(); };
  btn.style.position = "absolute";
  btn.style.top = "-6px";
  btn.style.right = "-6px";
  btn.style.width = "24px";
  btn.style.height = "24px";
  btn.style.borderRadius = "12px";
  btn.style.border = "none";
  btn.style.background = "rgba(255,255,255,.92)";
  btn.style.boxShadow = "0 6px 18px rgba(0,0,0,.12)";
  btn.style.fontWeight = "900";
  btn.style.cursor = "pointer";

  wrap.appendChild(img);
  wrap.appendChild(btn);
  return wrap;
}

function renderSlots() {
  const container = $("slots");
  container.innerHTML = "";

  for (const s of SLOTS) {
    const k = s.key;

    const row = document.createElement("div");
    row.className = "slot";

    const box = document.createElement("div");
    box.className = "slot-img";

    // 点击图片区域也可以直接打开选择器
    box.style.cursor = "pointer";
    box.onclick = () => openPickerForSlot(k);

    const right = document.createElement("div");
    right.className = "slot-right";

    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = s.label;

    const sub = document.createElement("div");
    sub.className = "slot-sub";

    const actions = document.createElement("div");
    actions.className = "slot-actions";

    const btnChoose = document.createElement("button");
    btnChoose.className = "btn ghost sm";
    btnChoose.textContent = MULTI_SLOTS.has(k) ? "添加" : "选择";
    btnChoose.onclick = () => openPickerForSlot(k);

    const btnClear = document.createElement("button");
    btnClear.className = "btn ghost sm";
    btnClear.textContent = "清除";
    btnClear.onclick = () => {
      clearSlot(k);
      renderSlots();
    };

    actions.appendChild(btnChoose);
    actions.appendChild(btnClear);

    // 单件槽位
    if (!MULTI_SLOTS.has(k)) {
      const it = items.find(x => x.id === activeOutfit[k]) || null;
      if (it) {
        const img = document.createElement("img");
        img.alt = "slot";
        img.dataset.itemId = it.id;
        img.dataset.kind = "thumb";
        img.removeAttribute("src");
        observeLazyImg(img);
        box.innerHTML = "";
        box.appendChild(img);
        sub.textContent = summarizeOne(it);
      } else {
        box.textContent = "空";
        sub.textContent = "";
      }
    } else {
      // 多件槽位（top/pants）
      const ids = activeOutfit[k] || [];
      if (ids.length === 0) {
        box.textContent = "空";
        sub.textContent = "";
      } else {
        box.innerHTML = "";
        const strip = document.createElement("div");
        strip.style.display = "flex";
        strip.style.gap = "8px";
        strip.style.overflowX = "auto";
        strip.style.alignItems = "center";
        strip.style.padding = "2px";
        strip.style.width = "100%";
        strip.style.height = "100%";

        for (const id of ids) {
          const it = items.find(x => x.id === id);
          if (!it) continue;
          strip.appendChild(makeThumbWithRemove(id, () => {
            removeFromSlot(k, id);
            renderSlots();
          }));
        }

        box.appendChild(strip);
        sub.textContent = summarizeMulti(ids);
      }
    }

    right.appendChild(name);
    right.appendChild(sub);
    right.appendChild(actions);

    row.appendChild(box);
    row.appendChild(right);
    container.appendChild(row);
  }
}

function setOutfitSlot(slotKey, itemId) {
  const id = String(itemId);
  if (!slotKey) return;

  if (MULTI_SLOTS.has(slotKey)) {
    const arr = activeOutfit[slotKey] || [];
    if (!arr.includes(id)) arr.push(id);
    activeOutfit[slotKey] = arr;
  } else {
    activeOutfit[slotKey] = id;
  }
  renderSlots();
}

function removeFromSlot(slotKey, itemId) {
  const id = String(itemId);
  if (MULTI_SLOTS.has(slotKey)) {
    activeOutfit[slotKey] = (activeOutfit[slotKey] || []).filter(x => x !== id);
  } else {
    if (activeOutfit[slotKey] === id) activeOutfit[slotKey] = null;
  }
}

function clearSlot(slotKey) {
  if (MULTI_SLOTS.has(slotKey)) activeOutfit[slotKey] = [];
  else activeOutfit[slotKey] = null;
}

function clearOutfit() {
  activeOutfit = normalizeOutfitSlots({});
  renderSlots();
  toast("已清空");
}

/* ---------- picker modal（上衣/裤子支持连续添加） ---------- */

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
      toast("已添加");
      // ✅ 多件槽位不自动关闭，方便连续加
      if (!MULTI_SLOTS.has(pickerSlotKey)) hideMask("pickerMask");
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

  const imgEl = $("editImg");
  imgEl.alt = "edit";
  imgEl.dataset.itemId = it.id;
  imgEl.dataset.kind = "full";
  imgEl.removeAttribute("src");
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

  // ✅ 分类改了：从不匹配槽位移除
  purgeOutfitByCategoryRule(it.id, it.category);

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

  // ✅ 从搭配里移除（包含 top/pants 数组）
  removeItemFromOutfitEverywhere(it.id);

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
  await reloadData();
  resetForm();
  toast("已保存");
}

/* ---------- outfits（保存/加载兼容 top/pants 多件） ---------- */

async function saveCurrentOutfit() {
  const name = normalizeStr($("outfitName").value);
  const hasAny =
    !!activeOutfit.hat ||
    !!activeOutfit.scarf ||
    !!activeOutfit.shoes ||
    (activeOutfit.top && activeOutfit.top.length > 0) ||
    (activeOutfit.pants && activeOutfit.pants.length > 0);

  if (!hasAny) { toast("搭配是空的"); return; }

  const outfit = {
    id: uuid(),
    name: name || `搭配 ${new Date().toLocaleString()}`,
    createdAt: nowISO(),
    slots: normalizeOutfitSlots(activeOutfit)
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
      activeOutfit = normalizeOutfitSlots(o.slots || {});
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
    const pending = items
      .map(normalizeItem)
      .filter(it => it.imageBlob && !it.imageThumbBlob);

    if (pending.length === 0) return;

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
        } catch {}
      }

      items = await idbGetAll(STORE_ITEMS);
      updateFilterOptions();
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
    updateFilterOptions();
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
