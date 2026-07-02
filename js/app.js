
/* GoldenBird Inventory v3.0.5｜Runtime 基礎修正 */
function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STORAGE_KEY = "goldenbird_inventory_demo_v3";
const GB_SYNC_DOC_PATH = "system/main";
const ROLE_KEY = "goldenbird_role_lock_v1";

const defaultData = {
  mappings: [
    { id: "M001", keyword: "亚克力板 / 透明板 / 有机玻璃", itemId: "I002", note: "OCR 辨識到類似字詞時，自動歸到內部品項" },
    { id: "M002", keyword: "彩色悬浮包装盒 / 悬浮盒", itemId: "I005", note: "避免平台 SEO 長標題造成庫存名稱混亂" },
    { id: "M003", keyword: "麻布袋 / 手提袋 / B5", itemId: "I006", note: "同商品不同賣場名稱可集中管理" }
  ],
  items: [
    { id: "I001", category: "彩印", name: "墨水（黑）", stock: 5, safety: 3, dept: "彩印", mode: "觀察型", note: "只需定期更新，不做細部扣料", disabled: false },
    { id: "I002", category: "彩印", name: "壓克力板 3mm", stock: 20, safety: 50, dept: "彩印 / 木頭", mode: "共用型", note: "木頭和彩印都會用到，庫存共用", disabled: false },
    { id: "I003", category: "木頭", name: "木盒小", stock: 10, safety: 30, dept: "木頭", mode: "觀察型", note: "", disabled: false },
    { id: "I004", category: "金屬", name: "黃銅吊飾", stock: 60, safety: 40, dept: "金屬", mode: "觀察型", note: "", disabled: false },
    { id: "I005", category: "包材", name: "懸浮盒 70x70x20", stock: 50, safety: 120, dept: "包材", mode: "共用型", note: "多部門會查詢", disabled: false },
    { id: "I006", category: "包材", name: "麻布袋 B5", stock: 15, safety: 80, dept: "包材", mode: "觀察型", note: "", disabled: false }
  ],
  orders: [
    { id: "O001", date: "2026-04-24", itemId: "I006", qty: 200, received: 0, cost: 1549, source: "1688", person: "老闆", status: "在途" },
    { id: "O002", date: "2026-04-24", itemId: "I005", qty: 1000, received: 0, cost: 1640, source: "1688", person: "老闆", status: "在途" },
    { id: "O003", date: "2026-04-24", itemId: "I001", qty: 10, received: 10, cost: 520, source: "蝦皮", person: "青", status: "已到貨" }
  ]
};

let data = loadData();
let lockedRole = localStorage.getItem(ROLE_KEY);
let pendingRole = null;
let lastUpdatedItemId = null;
let lastCreatedOrderId = null;
let lastCreatedItemId = null;
let lastCreatedMappingId = null;
let currentTab = "overview";
let stockSortAsc = null;
let restockOnly = false;
let selectedCostYear = "";
let gbRemoteReady = false;
let gbIsApplyingRemote = false;
let gbUnsubscribeMainDoc = null;
let gbSaveTimer = null;
let orderMonthFilterValue = "all";
let orderSearchKeyword = "";
let orderPersonFilterValue = "all";
let itemManageCategoryValue = "all";

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(defaultData));
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return cloneDefaultData();

  try {
    const parsed = JSON.parse(raw);
    parsed.items = Array.isArray(parsed.items) ? parsed.items : cloneDefaultData().items;
    parsed.orders = Array.isArray(parsed.orders) ? parsed.orders : cloneDefaultData().orders;
    parsed.mappings = Array.isArray(parsed.mappings) ? parsed.mappings : cloneDefaultData().mappings;
    parsed.history = Array.isArray(parsed.history) ? parsed.history : [];

    parsed.items = parsed.items.map(item => ({
      stock: 0,
      safety: 0,
      disabled: false,
      note: "",
      mode: "觀察型",
      dept: item.category || "",
      ...item
    }));

    parsed.orders = parsed.orders.map(order => ({
      received: 0,
      cost: 0,
      source: "-",
      status: "在途",
      person: "-",
      ...order
    }));

    return parsed;
  } catch (error) {
    console.error(error);
    return cloneDefaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  queueRemoteSave();
}

function resetDemoData() {
  data = cloneDefaultData();
  saveData();

  safeOn("orderMonthFilter", "change", event => {
    orderMonthFilterValue = event.target.value;
  });
  safeOn("orderPersonFilter", "change", event => {
    orderPersonFilterValue = event.target.value;
  });
  safeOn("applyOrderFilterBtn", "click", applyOrderFilters);
  safeOn("orderSearchInput", "keydown", event => {
    if (event.key === "Enter") applyOrderFilters();
  });
  safeOn("applyOrderFilterBtn", "click", applyOrderFilters);
  safeOn("orderSearchInput", "keydown", event => { if (event.key === "Enter") applyOrderFilters(); });
  safeOn("resetOrderFilterBtn", "click", resetOrderFilters);

  safeOn("itemManageCategoryFilter", "change", event => {
    itemManageCategoryValue = event.target.value;
    renderItemManageTable();
  });
  safeOn("resetItemManageFilterBtn", "click", resetItemManageFilters);

  renderAll();
  showToast("已重置示範資料");
}

function getItem(id) {
  return data.items.find(item => item.id === id);
}

function getIncomingQty(itemId) {
  return data.orders
    .filter(order => order.itemId === itemId)
    .reduce((sum, order) => sum + Math.max(0, Number(order.qty) - Number(order.received)), 0);
}

function getStatus(item) {
  const incoming = getIncomingQty(item.id);

  if (item.stock + incoming === 0) return { text: "❗完全缺貨", type: "bad" };
  if (item.stock === 0 && incoming > 0) return { text: "⚠️待到貨", type: "warn" };
  if (item.stock < item.safety && incoming > 0) return { text: "🚚在途補貨", type: "info" };
  if (item.stock < item.safety) return { text: "❗不足", type: "bad" };

  return { text: "正常", type: "good" };
}

function updateOrderStatus(order) {
  if (order.received <= 0) order.status = "在途";
  else if (order.received < order.qty) order.status = "部分到貨";
  else order.status = "已到貨";
}

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  document.querySelectorAll(".tab-panel, section.panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== tab);
  });

  renderAll();
}

function renderAll() {
  ensureRoleOptions();
  ensureStockHistoryUI();
  renderInventory();
  renderIncoming();
  renderReceiveTable();
  renderAdmin();
  setManualOrderDefaultDate();
  renderStockHistory();
  ensureExcelExportButton();
  bindOcrAssistant();
}

function renderInventory() {
  const grid = document.getElementById("inventoryGrid");
  const search = document.getElementById("searchInput").value.trim();
  const category = document.getElementById("categoryFilter").value;

  let filtered = data.items
    .filter(item => !item.disabled)
    .filter(item =>
      (!search || item.name.includes(search) || item.category.includes(search) || item.dept.includes(search)) &&
      (category === "all" || item.category === category)
    );

  if (restockOnly) {
    filtered = filtered.filter(item => {
      const suggest = Math.max(0, item.safety - (item.stock + getIncomingQty(item.id)));
      return suggest > 0 || item.stock < item.safety;
    });
  }

  const restockButton = document.getElementById("restockToggleBtn");
  restockButton.textContent = restockOnly ? "顯示全部" : "只看需補貨";

  if (stockSortAsc !== null) {
    filtered.sort((a, b) => stockSortAsc ? a.stock - b.stock : b.stock - a.stock);
  }

  if (lastUpdatedItemId) {
    filtered.sort((a, b) => (b.id === lastUpdatedItemId) - (a.id === lastUpdatedItemId));
  }

  if (!filtered.length) {
    grid.innerHTML = "<p>沒有符合的品項</p>";
    return;
  }

  const role = document.getElementById("roleSelect").value;
  const canEditSafety = role === "process" || role === "boss" || role === "qing" || role === "emily";

  const rows = filtered.map(item => {
    const incoming = getIncomingQty(item.id);
    const status = getStatus(item);
    const suggest = Math.max(0, item.safety - (item.stock + incoming));
    const isShared = item.mode === "共用型";
    const modeLabel = isShared ? "共用庫存" : "";
    const deptLabel = (item.dept || item.category || "").replace(/\s*\/\s*/g, "、");

    const safetyHtml = canEditSafety
      ? `<input type="number" min="0" value="${item.safety}" class="safety-input" data-id="${item.id}" />`
      : item.safety;

    return `
      <div class="inventory-row ${item.id === lastUpdatedItemId ? "updated-row" : ""}">
        <div class="inventory-name">
          <strong>${item.name}</strong>
          <div class="meta-tags">
            <span class="meta-tag category">${item.category}</span>
            <span class="meta-tag dept">${deptLabel}部管理</span>
            ${modeLabel ? `<span class="meta-tag mode">${modeLabel}</span>` : ""}
            <span class="meta-tag">${getLastUpdateText(item)}</span>
          </div>
        </div>
        <div class="num-cell stock-cell">${item.stock}</div>
        <div class="num-cell incoming-cell">${incoming}</div>
        <div class="num-cell safety-cell">${safetyHtml}</div>
        <div><span class="badge ${status.type}">${status.text}</span></div>
        <div class="suggest-cell">${suggest}</div>
      </div>
    `;
  }).join("");

  grid.innerHTML = `
    <div class="inventory-list">
      <div class="inventory-row header">
        <div>品項</div>
        <div id="stockSortHeader" style="cursor:pointer">庫存 ⬍</div>
        <div>在途</div>
        <div>安全</div>
        <div>狀態</div>
        <div>建議補貨</div>
      </div>
      ${rows}
    </div>
  `;

  document.getElementById("stockSortHeader").addEventListener("click", toggleStockSort);

  document.querySelectorAll(".safety-input").forEach(input => {
    input.addEventListener("change", event => {
      updateSafety(event.target.dataset.id, event.target.value);
    });
  });
}

function renderIncoming() {
  const tbody = document.getElementById("incomingTable");
  const activeOrders = data.orders.filter(order => order.qty - order.received > 0);

  tbody.innerHTML = activeOrders.map(order => {
    const item = getItem(order.itemId);
    const remain = Math.max(0, order.qty - order.received);
    const statusClass = order.status === "部分到貨" ? "warn" : "info";

    return `
      <tr class="${order.id === lastCreatedOrderId ? "highlight-row" : ""}">
        <td>${order.date}</td>
        <td>${item ? item.name : (order.deletedItemName || "已刪除品項")}</td>
        <td>${order.qty}</td>
        <td>${order.received}</td>
        <td>${remain}</td>
        <td><span class="badge ${statusClass}">${order.status}</span></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">目前沒有在途商品</td></tr>`;
}

function renderReceiveTable() {
  const tbody = document.getElementById("receiveTable");
  const activeOrders = data.orders.filter(order => order.qty - order.received > 0);

  tbody.innerHTML = activeOrders.map(order => {
    const item = getItem(order.itemId);
    const remain = Math.max(0, order.qty - order.received);

    return `
      <tr>
        <td>${item ? item.name : (order.deletedItemName || "已刪除品項")}<br><small>${order.date}｜${order.status}</small></td>
        <td>${remain}</td>
        <td><input class="receive-input" data-id="${order.id}" type="number" min="1" max="${remain}" placeholder="輸入數量" style="width:110px;"></td>
        <td><button class="small receive-btn" data-id="${order.id}">確認到貨</button></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4">目前沒有待到貨項目</td></tr>`;

  document.querySelectorAll(".receive-btn").forEach(button => {
    button.addEventListener("click", () => receiveOrder(button.dataset.id));
  });
}


function setManualOrderDefaultDate() {
  const input = document.getElementById("manualOrderDate");
  if (input && !input.value) input.value = new Date().toISOString().slice(0, 10);
}

function renderAdmin() {
  const role = document.getElementById("roleSelect").value;
  const canManage = role === "boss" || role === "qing" || role === "emily";
  const personName = role === "qing" ? "青" : (role === "emily" ? "Emily" : "老闆");

  document.getElementById("adminLocked").classList.toggle("hidden", canManage);
  document.getElementById("adminContent").classList.toggle("hidden", !canManage);

  const display = document.getElementById("orderPersonDisplay");
  if (display) display.value = personName;

  if (!canManage) return;

  renderAdminOrders();
  renderCostReport();
  renderItemManageTable();
  renderMappingManager();
}


function refreshOrderFilterOptions() {
  const select = document.getElementById("orderMonthFilter");
  if (!select) return;

  const months = [...new Set(data.orders.map(order => (order.date || "").slice(0, 7)).filter(Boolean))]
    .sort()
    .reverse();

  const currentValue = orderMonthFilterValue || "all";
  select.innerHTML = `<option value="all">全部月份</option>` + months.map(month =>
    `<option value="${month}">${month}</option>`
  ).join("");

  select.value = months.includes(currentValue) ? currentValue : "all";
  orderMonthFilterValue = select.value;
}

function refreshItemCategoryFilterOptions() {
  const select = document.getElementById("itemManageCategoryFilter");
  if (!select) return;

  const categories = [...new Set(data.items.map(item => item.category).filter(Boolean))]
    .sort();

  const currentValue = itemManageCategoryValue || "all";
  select.innerHTML = `<option value="all">全部分類</option>` + categories.map(category =>
    `<option value="${category}">${category}</option>`
  ).join("");

  select.value = categories.includes(currentValue) ? currentValue : "all";
  itemManageCategoryValue = select.value;
}


function applyOrderFilters() {
  orderMonthFilterValue = document.getElementById("orderMonthFilter")?.value || "all";
  orderPersonFilterValue = document.getElementById("orderPersonFilter")?.value || "all";
  orderSearchKeyword = document.getElementById("orderSearchInput")?.value.trim() || "";
  renderAdminOrders();
}

function updateOrderFilterStatus(count) {
  const status = document.getElementById("orderFilterStatus");
  if (!status) return;

  const monthText = orderMonthFilterValue === "all" ? "全部月份" : orderMonthFilterValue;
  const personText = orderPersonFilterValue === "all" ? "" : `｜叫貨人：${orderPersonFilterValue}`;
  const keywordText = orderSearchKeyword ? `｜關鍵字：${orderSearchKeyword}` : "";
  status.textContent = `目前顯示：${monthText}${personText}${keywordText}｜共 ${count} 筆`;
  status.classList.toggle("active", orderMonthFilterValue !== "all" || orderPersonFilterValue !== "all" || !!orderSearchKeyword);
}

function resetOrderFilters() {
  orderMonthFilterValue = "all";
  orderSearchKeyword = "";
  orderPersonFilterValue = "all";
  const month = document.getElementById("orderMonthFilter");
  const person = document.getElementById("orderPersonFilter");
  const search = document.getElementById("orderSearchInput");
  if (month) month.value = "all";
  if (person) person.value = "all";
  if (search) search.value = "";
  renderAdminOrders();
}

function resetItemManageFilters() {
  itemManageCategoryValue = "all";
  const category = document.getElementById("itemManageCategoryFilter");
  const search = document.getElementById("itemManageSearch");
  if (category) category.value = "all";
  if (search) search.value = "";
  renderItemManageTable();
}

function renderAdminOrders() {
  const tbody = document.getElementById("adminOrdersTable");

  refreshOrderFilterOptions();

  const orderSearchInput = document.getElementById("orderSearchInput");
  const orderMonthSelect = document.getElementById("orderMonthFilter");
  const orderPersonSelect = document.getElementById("orderPersonFilter");
  if (orderSearchInput) orderSearchInput.value = orderSearchKeyword || "";
  if (orderMonthSelect) orderMonthSelect.value = orderMonthFilterValue || "all";
  if (orderPersonSelect) orderPersonSelect.value = orderPersonFilterValue || "all";

  const filteredOrders = data.orders.filter(order => {
    const item = getItem(order.itemId);
    const itemName = item ? item.name : (order.deletedItemName || "已刪除品項");
    const monthMatch = orderMonthFilterValue === "all" || (order.date || "").slice(0, 7) === orderMonthFilterValue;
    const personMatch = orderPersonFilterValue === "all" || (order.person || "") === orderPersonFilterValue;
    const keyword = orderSearchKeyword;
    const keywordMatch = !keyword ||
      itemName.includes(keyword) ||
      (order.source || "").includes(keyword);
    return monthMatch && personMatch && keywordMatch;
  });

  updateOrderFilterStatus(filteredOrders.length);

  tbody.innerHTML = filteredOrders.map(order => {
    const item = getItem(order.itemId);

    return `
      <tr class="${order.id === lastCreatedOrderId ? "highlight-row" : ""}">
        <td>${order.date}</td>
        <td>${item ? item.name : (order.deletedItemName || "已刪除品項")}</td>
        <td>${order.qty}</td>
        <td>${order.received}</td>
        <td>NT$ ${order.cost}</td>
        <td>${order.source}</td>
        <td>${order.person || "-"}</td>
        <td>${order.status}</td>
        <td>
          <button class="secondary small edit-order-btn" data-id="${order.id}">修改</button>
          <button class="danger small delete-order-btn" data-id="${order.id}">刪除</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">沒有符合的叫貨紀錄</td></tr>`;

  document.querySelectorAll(".edit-order-btn").forEach(button => {
    button.addEventListener("click", () => editOrder(button.dataset.id));
  });

  document.querySelectorAll(".delete-order-btn").forEach(button => {
    button.addEventListener("click", () => deleteOrder(button.dataset.id));
  });
}

function renderCostReport() {
  const yearSelect = document.getElementById("costYearSelect");
  const monthlyTable = document.getElementById("monthlyCostTable");
  if (!yearSelect || !monthlyTable) return;

  const years = [...new Set(data.orders.map(order => (order.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const currentYear = new Date().getFullYear().toString();

  if (!selectedCostYear) {
    selectedCostYear = years.includes(currentYear) ? currentYear : (years[0] || currentYear);
  }

  yearSelect.innerHTML = years.map(year =>
    `<option value="${year}" ${year === selectedCostYear ? "selected" : ""}>${year}</option>`
  ).join("") || `<option value="${currentYear}">${currentYear}</option>`;

  const monthly = {};

  data.orders.forEach(order => {
    const year = (order.date || "").slice(0, 4);
    if (year !== selectedCostYear) return;

    const month = order.date.slice(0, 7);
    if (!monthly[month]) monthly[month] = { total: 0, incoming: 0, package: 0 };

    const cost = Number(order.cost) || 0;
    monthly[month].total += cost;

    if (order.status !== "已到貨") {
      monthly[month].incoming += cost;
    }

    const item = getItem(order.itemId);
    if (item && item.category === "包材") {
      monthly[month].package += cost;
    }
  });

  const rows = Object.entries(monthly).sort().reverse();
  const yearTotal = rows.reduce((sum, [, row]) => sum + row.total, 0);

  document.getElementById("yearTotalCost").value = `NT$ ${yearTotal}`;

  monthlyTable.innerHTML = rows.map(([month, row]) => `
    <tr>
      <td>${month}</td>
      <td>NT$ ${row.total}</td>
      <td>NT$ ${row.incoming}</td>
      <td>NT$ ${row.package}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">此年度尚無成本資料</td></tr>`;

  const cards = document.getElementById("monthlyCostCards");
  if (cards) {
    cards.innerHTML = rows.map(([month, row]) => `
      <div class="cost-card">
        <div class="cost-card-title">${month}</div>
        <div class="cost-card-row"><span>總進貨成本</span><span>NT$ ${row.total}</span></div>
        <div class="cost-card-row"><span>在途成本</span><span>NT$ ${row.incoming}</span></div>
        <div class="cost-card-row"><span>包材成本</span><span>NT$ ${row.package}</span></div>
      </div>
    `).join("") || `<div class="cost-card">此年度尚無成本資料</div>`;
  }
}

function renderItemManageTable() {
  refreshItemCategoryFilterOptions();

  const keyword = document.getElementById("itemManageSearch").value.trim();
  itemManageCategoryValue = document.getElementById("itemManageCategoryFilter")?.value || itemManageCategoryValue || "all";
  const tbody = document.getElementById("itemManageTable");

  const rows = data.items
    .filter(item => itemManageCategoryValue === "all" || item.category === itemManageCategoryValue)
    .filter(item => !keyword || item.name.includes(keyword) || item.category.includes(keyword) || (item.dept || "").includes(keyword))
    .map(item => `
      <tr class="${item.id === lastCreatedItemId ? "highlight-row" : ""}">
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${item.safety}</td>
        <td>${item.disabled ? "已停用" : "使用中"}</td>
        <td>
          <button class="secondary small edit-item-btn" data-id="${item.id}">修改</button>
          <button class="danger small toggle-item-btn" data-id="${item.id}">${item.disabled ? "啟用" : "停用"}</button>
          <button class="danger small delete-item-btn" data-id="${item.id}" style="background:#7a1f1f">刪除</button>
        </td>
      </tr>
    `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="5">找不到符合的品項</td></tr>`;

  document.querySelectorAll(".edit-item-btn").forEach(button => {
    button.addEventListener("click", () => editItem(button.dataset.id));
  });

  document.querySelectorAll(".toggle-item-btn").forEach(button => {
    button.addEventListener("click", () => toggleItemDisabled(button.dataset.id));
  });

  document.querySelectorAll(".delete-item-btn").forEach(button => {
    button.addEventListener("click", () => openDeleteItem(button.dataset.id));
  });
}

function renderMappingManager() {
  const tbody = document.getElementById("mappingTable");
  if (!tbody) return;

  tbody.innerHTML = (data.mappings || []).map(mapping => {
    const item = getItem(mapping.itemId);

    return `
      <tr class="${mapping.id === lastCreatedMappingId ? "highlight-row" : ""}">
        <td>${mapping.keyword}</td>
        <td>${item ? item.name : "已刪除品項"}</td>
        <td>${mapping.note || ""}</td>
        <td><button class="danger small delete-mapping-btn" data-id="${mapping.id}">刪除</button></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4">尚未建立對應資料</td></tr>`;

  document.querySelectorAll(".delete-mapping-btn").forEach(button => {
    button.addEventListener("click", () => deleteMapping(button.dataset.id));
  });
}

function renderAutocomplete(inputId, listId, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  const keyword = input.value.trim();
  if (!keyword) {
    list.innerHTML = "";
    return;
  }

  const filtered = data.items.filter(item => !item.disabled && item.name.includes(keyword));

  if (!filtered.length) {
    list.innerHTML = `<div class="auto-item auto-empty">沒有符合品項，請先到「品項管理」新增</div>`;
    return;
  }

  list.innerHTML = filtered.map(item =>
    `<div class="auto-item" data-id="${item.id}">${item.name}</div>`
  ).join("");

  list.querySelectorAll(".auto-item").forEach(element => {
    element.addEventListener("click", () => {
      const item = getItem(element.dataset.id);
      if (item) onSelect(item);
    });
  });
}

function selectStockItem(item) {
  document.getElementById("stockSearchInput").value = item.name;
  document.getElementById("stockItemSelect").value = item.id;
  document.getElementById("autocompleteList").innerHTML = "";
  updateSelectedStockInfo(item);
}

function selectMappingItem(item) {
  document.getElementById("mappingItemSearch").value = item.name;
  document.getElementById("mappingItemSelect").value = item.id;
  document.getElementById("mappingAutocompleteList").innerHTML = "";
}

function updateSafety(itemId, value) {
  const role = document.getElementById("roleSelect").value;
  if (!(role === "process" || role === "boss" || role === "qing" || role === "emily")) {
    showToast("無權限");
    return;
  }

  const item = getItem(itemId);
  const numericValue = Number(value);

  if (!item || Number.isNaN(numericValue) || numericValue < 0) {
    showToast("安全庫存不正確");
    return;
  }

  item.safety = numericValue;
  saveData();
  renderAll();
  showToast(`${item.name} 安全庫存已更新為 ${numericValue}`);
}


function selectQuickStockItem(item) {
  document.getElementById("quickStockSearchInput").value = item.name;
  document.getElementById("quickStockItemSelect").value = item.id;
  document.getElementById("quickAutocompleteList").innerHTML = "";
}

function quickUpdateStock() {
  const itemId = document.getElementById("quickStockItemSelect").value;
  const qty = Number(document.getElementById("quickStockQtyInput").value);
  const item = getItem(itemId);

  if (!item || Number.isNaN(qty) || qty < 0) {
    showToast("請先搜尋並選擇品項，再輸入正確庫存");
    return;
  }

  const oldStock = Number(item.stock) || 0;
  item.stock = qty;
  addStockHistory(item, oldStock, qty, "盤點更新", document.getElementById("stockNoteInput").value.trim());
  lastUpdatedItemId = item.id;
  saveData();

  document.getElementById("quickStockSearchInput").value = "";
  document.getElementById("quickStockItemSelect").value = "";
  document.getElementById("quickStockQtyInput").value = "";

  renderInventory();
  renderIncoming();
  renderReceiveTable();
  renderAdmin();

  showToast(`${item.name} 已更新為 ${qty}，已移到第一列`);
}


function getCurrentUserLabel() {
  if (window.GB_AUTH && window.GB_AUTH.user) {
    const email = window.GB_AUTH.user.email || "";
    if (email === "unrealmonde@gmail.com") return "Emily";
    if (email === "hey2501@gmail.com") return "青";
    if (email === "sun4041098@gmail.com") return "老闆";
    return window.GB_AUTH.user.displayName || email || "未知使用者";
  }

  const role = document.getElementById("roleSelect")?.value || "staff";
  const labels = { emily: "Emily", boss: "老闆", qing: "青", process: "製程人員", staff: "全員 / 美編" };
  return labels[role] || role;
}

function getCurrentUserEmail() {
  return window.GB_AUTH?.user?.email || "";
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function getLastUpdateText(item) {
  if (!item || !item.lastUpdatedAt) return "最後更新：尚無紀錄";
  const by = item.lastUpdatedBy || "未知";
  const type = item.lastUpdateType ? `｜${item.lastUpdateType}` : "";
  return `最後更新：${by}｜${formatDateTime(item.lastUpdatedAt)}${type}`;
}


function ensureStockHistoryStyles() {
  if (document.getElementById("stockHistoryStyles")) return;
  const style = document.createElement("style");
  style.id = "stockHistoryStyles";
  style.textContent = `
    .stock-info-box{
      background:#f8fbfb;
      border:1px solid var(--line);
      border-radius:14px;
      padding:12px;
      margin:12px 0;
      line-height:1.7;
    }
    .stock-history-list{
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .history-row{
      border:1px solid var(--line);
      border-radius:14px;
      padding:12px;
      background:#fff;
      line-height:1.6;
    }
    .history-meta{
      color:var(--muted);
      font-size:13px;
      margin-top:4px;
    }
  `;
  document.head.appendChild(style);
}

function ensureStockHistoryUI() {
  ensureStockHistoryStyles();
  const updatePanel = document.getElementById("update");
  if (!updatePanel) return;

  const stockCard = document.getElementById("stockSearchInput")?.closest(".card");
  if (stockCard && !document.getElementById("selectedStockInfo")) {
    const info = document.createElement("div");
    info.id = "selectedStockInfo";
    info.className = "note stock-info-box";
    info.textContent = "選擇品項後，這裡會顯示目前庫存與最後更新紀錄。";
    const note = stockCard.querySelector(".note");
    if (note) note.insertAdjacentElement("afterend", info);
    else stockCard.appendChild(info);
  }

  if (!document.getElementById("stockHistoryList")) {
    const section = document.createElement("div");
    section.className = "section-title";
    section.innerHTML = `<h2>最近庫存異動</h2><span class="badge info">最近 10 筆</span>`;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div id="stockHistoryList" class="stock-history-list">尚無庫存異動紀錄</div>`;

    updatePanel.appendChild(section);
    updatePanel.appendChild(card);
  }
}

function updateSelectedStockInfo(item) {
  const info = document.getElementById("selectedStockInfo");
  if (!info) return;

  if (!item) {
    info.textContent = "選擇品項後，這裡會顯示目前庫存與最後更新紀錄。";
    return;
  }

  info.innerHTML = `
    <strong>${item.name}</strong><br>
    目前庫存：${item.stock}<br>
    ${getLastUpdateText(item)}
  `;
}

function addStockHistory(item, oldStock, newStock, type, note = "") {
  if (!data.history) data.history = [];

  const record = {
    id: `H${Date.now()}${Math.floor(Math.random() * 1000)}`,
    itemId: item.id,
    itemName: item.name,
    oldStock: Number(oldStock) || 0,
    newStock: Number(newStock) || 0,
    change: (Number(newStock) || 0) - (Number(oldStock) || 0),
    type,
    note,
    user: getCurrentUserLabel(),
    email: getCurrentUserEmail(),
    time: Date.now()
  };

  data.history.unshift(record);
  data.history = data.history.slice(0, 200);

  item.lastUpdatedBy = record.user;
  item.lastUpdatedEmail = record.email;
  item.lastUpdatedAt = record.time;
  item.lastUpdateType = type;

  return record;
}

function renderStockHistory() {
  const list = document.getElementById("stockHistoryList");
  if (!list) return;

  const records = (data.history || []).slice(0, 10);

  if (!records.length) {
    list.innerHTML = "尚無庫存異動紀錄";
    return;
  }

  list.innerHTML = records.map(record => {
    const changeText = record.change > 0 ? `+${record.change}` : `${record.change}`;
    return `
      <div class="history-row">
        <div><strong>${record.itemName}</strong> <span class="meta-tag mode">${record.type}</span></div>
        <div>${record.oldStock} → ${record.newStock}（${changeText}）</div>
        <div class="history-meta">${record.user}｜${formatDateTime(record.time)}${record.note ? `｜${record.note}` : ""}</div>
      </div>
    `;
  }).join("");
}

function updateStock() {
  const itemId = document.getElementById("stockItemSelect").value;
  const qty = Number(document.getElementById("stockQtyInput").value);
  const item = getItem(itemId);

  if (!item || Number.isNaN(qty) || qty < 0) {
    showToast("請先搜尋並選擇品項，再輸入正確庫存");
    return;
  }

  const oldStock = Number(item.stock) || 0;
  item.stock = qty;
  addStockHistory(item, oldStock, qty, "快速更新");
  lastUpdatedItemId = item.id;
  saveData();
  renderAll();

  document.getElementById("stockSearchInput").value = "";
  document.getElementById("stockItemSelect").value = "";
  document.getElementById("stockQtyInput").value = "";
  document.getElementById("stockNoteInput").value = "";

  showToast(`${item.name} 已更新為 ${qty}`);
}

function receiveOrder(orderId) {
  const order = data.orders.find(item => item.id === orderId);
  if (!order) return;

  const input = document.querySelector(`.receive-input[data-id="${orderId}"]`);
  const qty = Number(input.value);
  const remain = order.qty - order.received;

  if (!qty || qty <= 0 || qty > remain) {
    showToast("請輸入正確到貨數量");
    return;
  }

  const item = getItem(order.itemId);
  order.received += qty;
  updateOrderStatus(order);

  if (item) {
    const oldStock = Number(item.stock) || 0;
    item.stock += qty;
    addStockHistory(item, oldStock, item.stock, "到貨入庫", `${order.date} 叫貨到貨`);
  }

  saveData();
  renderAll();
  showToast(`${item ? item.name : "品項"} 已到貨 ${qty}，庫存已增加`);
}


function autoSelectNewItemInSearchFields(item) {
  const targets = [
    {
      searchId: "manualOrderItemSearch",
      hiddenId: "manualOrderItemSelect",
      listId: "manualOrderAutocompleteList"
    },
    {
      searchId: "mappingItemSearch",
      hiddenId: "mappingItemSelect",
      listId: "mappingAutocompleteList"
    },
    {
      searchId: "quickStockSearchInput",
      hiddenId: "quickStockItemSelect",
      listId: "quickAutocompleteList"
    },
    {
      searchId: "stockSearchInput",
      hiddenId: "stockItemSelect",
      listId: "autocompleteList"
    }
  ];

  targets.forEach(target => {
    const search = document.getElementById(target.searchId);
    const hidden = document.getElementById(target.hiddenId);
    const list = document.getElementById(target.listId);

    if (!search || !hidden) return;

    const keyword = search.value.trim();
    if (!keyword) return;

    const isLikelySame =
      item.name.includes(keyword) ||
      keyword.includes(item.name) ||
      item.name.replace(/\s/g, "") === keyword.replace(/\s/g, "");

    if (isLikelySame) {
      search.value = item.name;
      hidden.value = item.id;
      if (list) list.innerHTML = `<div class="auto-selected">已自動選取：${item.name}</div>`;
    } else if (list && list.textContent.includes("沒有符合品項")) {
      list.innerHTML = "";
    }
  });
}


function createNewItem({ name, category, safety, dept, note, shared }) {
  if (!name) {
    showToast("請輸入品項名稱");
    return;
  }

  const newItem = {
    id: `I${Date.now()}`,
    name,
    category,
    stock: 0,
    safety: Number(safety) || 0,
    dept: dept || category,
    mode: shared ? "共用型" : "觀察型",
    note: note || "",
    disabled: false,
    lastUpdatedBy: getCurrentUserLabel(),
    lastUpdatedEmail: getCurrentUserEmail(),
    lastUpdatedAt: Date.now(),
    lastUpdateType: "新增品項"
  };

  data.items.push(newItem);
  lastCreatedItemId = newItem.id;
  autoSelectNewItemInSearchFields(newItem);

  saveData();
  renderAll();
  showToast("新品項已新增");
}

function addNewItemFromManage() {
  const name = document.getElementById("newItemNameManage").value.trim();
  const categoryInput = document.getElementById("newCategoryInput").value.trim();
  const categorySelect = document.getElementById("newItemCategoryManage");
  const category = categoryInput || categorySelect.value;
  const safety = Number(document.getElementById("newItemSafetyManage").value) || 0;
  const dept = document.getElementById("newItemDeptManage").value.trim() || category;

  if (categoryInput && ![...categorySelect.options].some(option => option.value === categoryInput)) {
    categorySelect.appendChild(new Option(categoryInput, categoryInput));
    categorySelect.value = categoryInput;
  }
  const note = document.getElementById("newItemNoteManage").value.trim();
  const shared = document.getElementById("newItemSharedManage").checked;

  createNewItem({ name, category, safety, dept, note, shared });

  document.getElementById("newItemNameManage").value = "";
  document.getElementById("newItemSafetyManage").value = "";
  document.getElementById("newItemDeptManage").value = "";
  document.getElementById("newItemNoteManage").value = "";
  document.getElementById("newCategoryInput").value = "";
  document.getElementById("newItemSharedManage").checked = false;
}

function addMapping() {
  const keyword = document.getElementById("mappingKeyword").value.trim();
  const itemId = document.getElementById("mappingItemSelect").value;
  const note = document.getElementById("mappingNote").value.trim();

  if (!keyword) {
    showToast("請輸入平台名稱或關鍵字");
    return;
  }

  if (!itemId) {
    showToast("請先從搜尋結果點選內部品項；若沒有，請先到品項管理新增");
    return;
  }

  const newMapping = {
    id: `M${Date.now()}`,
    keyword,
    itemId,
    note
  };

  data.mappings.push(newMapping);
  lastCreatedMappingId = newMapping.id;

  saveData();
  renderAll();

  document.getElementById("mappingKeyword").value = "";
  document.getElementById("mappingItemSearch").value = "";
  document.getElementById("mappingItemSelect").value = "";
  document.getElementById("mappingNote").value = "";

  showToast("商品對應已新增");
}

function deleteMapping(id) {
  data.mappings = data.mappings.filter(mapping => mapping.id !== id);
  saveData();
  renderAll();
  showToast("商品對應已刪除");
}


function selectManualOrderItem(item) {
  document.getElementById("manualOrderItemSearch").value = item.name;
  document.getElementById("manualOrderItemSelect").value = item.id;
  document.getElementById("manualOrderAutocompleteList").innerHTML = "";
}

function addManualOrder() {
  const itemId = document.getElementById("manualOrderItemSelect").value;
  const qty = Number(document.getElementById("manualOrderQty").value);
  const cost = Number(document.getElementById("manualOrderCost").value);
  const source = document.getElementById("manualOrderSource").value.trim() || "手動新增";
  const dateInput = document.getElementById("manualOrderDate").value;
  const role = document.getElementById("roleSelect").value;
  const person = role === "qing" ? "青" : (role === "emily" ? "Emily" : "老闆");

  const item = getItem(itemId);

  if (!item) {
    showToast("請先搜尋並選擇品項");
    return;
  }

  if (!qty || qty <= 0) {
    showToast("請輸入正確叫貨數量");
    return;
  }

  if (Number.isNaN(cost) || cost < 0) {
    showToast("請輸入正確成本");
    return;
  }

  const newOrder = {
    id: `O${Date.now()}`,
    date: dateInput || new Date().toISOString().slice(0, 10),
    itemId,
    qty,
    received: 0,
    cost,
    source,
    person,
    status: "在途"
  };

  data.orders.unshift(newOrder);
  lastCreatedOrderId = newOrder.id;

  saveData();
  renderAll();

  document.getElementById("manualOrderItemSearch").value = "";
  document.getElementById("manualOrderItemSelect").value = "";
  document.getElementById("manualOrderQty").value = "";
  document.getElementById("manualOrderCost").value = "";
  document.getElementById("manualOrderSource").value = "";
  document.getElementById("manualOrderDate").value = "";

  showToast(`${item.name} 已新增叫貨，狀態為在途`);
}

function editOrder(id) {
  const order = data.orders.find(item => item.id === id);
  if (!order) return;

  document.getElementById("editOrderId").value = order.id;
  document.getElementById("editOrderQty").value = order.qty;
  document.getElementById("editOrderReceived").value = order.received;
  document.getElementById("editOrderCost").value = order.cost;
  document.getElementById("editOrderSource").value = order.source;

  const select = document.getElementById("editOrderItem");
  select.innerHTML = data.items.map(item =>
    `<option value="${item.id}" ${item.id === order.itemId ? "selected" : ""}>${item.name}</option>`
  ).join("");

  openModal("editOrderModal");
}

function saveEditOrder() {
  const id = document.getElementById("editOrderId").value;
  const order = data.orders.find(item => item.id === id);
  if (!order) return;

  const qty = Number(document.getElementById("editOrderQty").value);
  const received = Number(document.getElementById("editOrderReceived").value);
  const cost = Number(document.getElementById("editOrderCost").value);
  const source = document.getElementById("editOrderSource").value.trim();
  const itemId = document.getElementById("editOrderItem").value;

  if (Number.isNaN(qty) || qty < 0) return showToast("叫貨數量不正確");
  if (Number.isNaN(received) || received < 0 || received > qty) return showToast("已到貨數量不正確");
  if (Number.isNaN(cost) || cost < 0) return showToast("成本不正確");

  order.itemId = itemId;
  order.qty = qty;
  order.received = received;
  order.cost = cost;
  order.source = source || "-";
  order.deletedItemName = "";

  updateOrderStatus(order);
  saveData();
  closeModal("editOrderModal");
  renderAll();
  showToast("叫貨紀錄已修改");
}

function deleteOrder(id) {
  data.orders = data.orders.filter(order => order.id !== id);
  saveData();
  renderAll();
  showToast("叫貨紀錄已刪除");
}

function editItem(id) {
  const item = getItem(id);
  if (!item) return;

  document.getElementById("editItemId").value = item.id;
  document.getElementById("editItemNameInput").value = item.name;
  document.getElementById("editItemCategoryInput").value = item.category;
  document.getElementById("editItemDeptInput").value = item.dept;
  document.getElementById("editItemSafetyInput").value = item.safety;
  document.getElementById("editItemNoteInput").value = item.note || "";
  document.getElementById("editItemSharedInput").checked = item.mode === "共用型";

  openModal("editItemModal");
}

function saveEditItem() {
  const id = document.getElementById("editItemId").value;
  const item = getItem(id);
  if (!item) return;

  const name = document.getElementById("editItemNameInput").value.trim();
  const category = document.getElementById("editItemCategoryInput").value;
  const dept = document.getElementById("editItemDeptInput").value.trim();
  const safety = Number(document.getElementById("editItemSafetyInput").value);
  const note = document.getElementById("editItemNoteInput").value.trim();
  const shared = document.getElementById("editItemSharedInput").checked;

  if (!name) return showToast("請輸入品項名稱");
  if (Number.isNaN(safety) || safety < 0) return showToast("安全庫存不正確");

  item.name = name;
  item.category = category;
  item.dept = dept || category;
  item.safety = safety;
  item.note = note;
  item.mode = shared ? "共用型" : "觀察型";

  saveData();
  closeModal("editItemModal");
  renderAll();
  showToast("品項資料已修改");
}

function toggleItemDisabled(id) {
  const item = getItem(id);
  if (!item) return;

  item.disabled = !item.disabled;
  saveData();
  renderAll();
  showToast(item.disabled ? "品項已停用" : "品項已重新啟用");
}

function openDeleteItem(id) {
  const item = getItem(id);
  if (!item) return;

  const relatedOrders = data.orders.filter(order => order.itemId === id);
  document.getElementById("deleteItemId").value = id;
  document.getElementById("deleteItemText").innerHTML = relatedOrders.length > 0
    ? `此品項已有 <b>${relatedOrders.length}</b> 筆叫貨紀錄。<br><br>建議優先使用「停用」，避免影響歷史資料。<br><br>仍要刪除 <b>${item.name}</b> 嗎？`
    : `確定刪除 <b>${item.name}</b> 嗎？`;

  openModal("deleteItemModal");
}

function confirmDeleteItem() {
  const id = document.getElementById("deleteItemId").value;
  const item = getItem(id);
  if (!item) return closeModal("deleteItemModal");

  const relatedOrders = data.orders.filter(order => order.itemId === id);
  relatedOrders.forEach(order => {
    order.deletedItemName = item.name;
    order.itemId = null;
  });

  data.items = data.items.filter(item => item.id !== id);
  saveData();
  closeModal("deleteItemModal");
  renderAll();
  showToast("品項已刪除");
}

function handleRoleChange() {
  if (window.GB_AUTH && window.GB_AUTH.ready) {
    document.getElementById("roleSelect").value = window.GB_AUTH.role || "staff";
    renderAll();
    return;
  }
  const role = document.getElementById("roleSelect").value;

  if ((role === "boss" || role === "qing") && lockedRole !== role) {
    pendingRole = role;
    document.getElementById("passwordInput").value = "";
    document.getElementById("passwordModalText").textContent =
      `請輸入管理密碼，驗證後會記住這台裝置為「${role === "qing" ? "青" : "老闆"}」。`;
    openModal("passwordModal");
    return;
  }

  renderAll();
}

function confirmPassword() {
  const password = document.getElementById("passwordInput").value;

  if (password !== "1234") {
    showToast("密碼錯誤");
    return;
  }

  if (pendingRole) {
    localStorage.setItem(ROLE_KEY, pendingRole);
    lockedRole = pendingRole;
    document.getElementById("roleSelect").value = pendingRole;
  }

  pendingRole = null;
  closeModal("passwordModal");
  showToast("已記住此裝置為管理者");
  renderAll();
}

function cancelPassword() {
  pendingRole = null;
  closeModal("passwordModal");
  document.getElementById("roleSelect").value = lockedRole || "staff";
  renderAll();
}

function toggleStockSort() {
  if (stockSortAsc === null) stockSortAsc = false;
  else if (stockSortAsc === false) stockSortAsc = true;
  else stockSortAsc = null;

  renderInventory();
}

function toggleRestockOnly() {
  restockOnly = !restockOnly;

  if (restockOnly && stockSortAsc === null) {
    stockSortAsc = true;
  }

  renderInventory();
  showToast(restockOnly ? "已切換：只看需補貨" : "已切換：顯示全部品項");
}

function openModal(id) {
  document.getElementById(id).classList.add("show");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("show");
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}


function clearRole() {
  localStorage.removeItem(ROLE_KEY);
  lockedRole = null;
  pendingRole = null;
  document.getElementById("roleSelect").value = "staff";
  renderAll();
  showToast("已清除這台裝置的管理身份");
}


function updateSyncStatus(text, type = "") {
  const el = document.getElementById("syncStatusText");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "warn", "bad");
  if (type) el.classList.add(type);
}

function getMainDocRef() {
  if (!window.GB_FIREBASE || !window.GB_FIREBASE.ready || !window.GB_FIREBASE.db) return null;
  return window.GB_FIREBASE.db.doc(GB_SYNC_DOC_PATH);
}

function normalizeRemoteData(remote) {
  if (!remote || !remote.payload) return null;
  const payload = remote.payload;
  if (!Array.isArray(payload.items)) payload.items = [];
  if (!Array.isArray(payload.orders)) payload.orders = [];
  if (!Array.isArray(payload.mappings)) payload.mappings = [];
  if (!Array.isArray(payload.history)) payload.history = [];
  return payload;
}

async function seedRemoteIfEmpty() {
  const ref = getMainDocRef();
  if (!ref) return;
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      payload: data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.GB_AUTH?.user?.email || "unknown",
      version: "v10"
    });
  }
}

function startRemoteSync() {
  const ref = getMainDocRef();
  if (!ref) {
    updateSyncStatus("未連線", "warn");
    return;
  }

  if (gbUnsubscribeMainDoc) gbUnsubscribeMainDoc();
  updateSyncStatus("同步連線中…", "warn");

  gbUnsubscribeMainDoc = ref.onSnapshot(snapshot => {
    if (!snapshot.exists) {
      seedRemoteIfEmpty();
      return;
    }

    const remoteData = normalizeRemoteData(snapshot.data());
    if (!remoteData) return;

    gbIsApplyingRemote = true;
    data = remoteData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    renderAll();
    gbIsApplyingRemote = false;
    gbRemoteReady = true;
    updateSyncStatus("已同步", "ok");
  }, error => {
    console.error("Firestore sync error:", error);
    updateSyncStatus("同步失敗", "bad");
  });
}

function queueRemoteSave() {
  if (gbIsApplyingRemote) return;
  if (!window.GB_FIREBASE || !window.GB_FIREBASE.ready || !window.GB_AUTH || !window.GB_AUTH.ready) return;

  const ref = getMainDocRef();
  if (!ref) return;

  updateSyncStatus("儲存中…", "warn");

  clearTimeout(gbSaveTimer);
  gbSaveTimer = setTimeout(async () => {
    try {
      await ref.set({
        payload: data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: window.GB_AUTH?.user?.email || "unknown",
        version: "v10"
      }, { merge: true });
      updateSyncStatus("已同步", "ok");
    } catch (error) {
      console.error("Remote save failed:", error);
      updateSyncStatus("儲存失敗", "bad");
    }
  }, 350);
}

async function uploadOrderScreenshot(file) {
  // v13 Firestore Clean：Spark 免費方案不使用 Firebase Storage。
  // 圖片僅本機預覽，不上傳雲端。
  if (!file) return null;
  return { path: "", url: "" };
}

function bindScreenshotPreview() {
  const input = document.getElementById("orderScreenshotInput");
  const preview = document.getElementById("screenshotPreview");
  if (!input || !preview || input.dataset.bound === "1") return;
  input.dataset.bound = "1";

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      preview.innerHTML = "";
      return;
    }

    const localUrl = URL.createObjectURL(file);
    preview.innerHTML = `已選擇：${file.name}<img src="${localUrl}" alt="叫貨截圖預覽" />`;

    preview.innerHTML += `<p>目前免費版：圖片僅本機預覽，不上傳雲端。</p>`;
  });
}



function ensureRoleOptions() {
  const select = document.getElementById("roleSelect");
  if (!select) return;

  const options = [
    { value: "emily", label: "Emily" },
    { value: "qing", label: "青" },
    { value: "boss", label: "老闆" },
    { value: "process", label: "製程人員" },
    { value: "staff", label: "全員 / 美編" }
  ];

  options.forEach(option => {
    if (![...select.options].some(existing => existing.value === option.value)) {
      select.appendChild(new Option(option.label, option.value));
    }
  });
}

function initRole() {
  ensureRoleOptions();
  if (window.GB_AUTH && window.GB_AUTH.ready) {
    document.getElementById("roleSelect").value = window.GB_AUTH.role || "staff";
    return;
  }
  if (lockedRole) {
    document.getElementById("roleSelect").value = lockedRole;
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(button => {
    if (button.dataset.tabBound === "true") return;
    button.addEventListener("click", () => switchTab(button.dataset.tab));
    button.dataset.tabBound = "true";
  });

  document.getElementById("searchInput").addEventListener("input", renderInventory);
  document.getElementById("categoryFilter").addEventListener("change", renderInventory);
  document.getElementById("roleSelect").addEventListener("change", handleRoleChange);
  const clearRoleBtn = document.getElementById("clearRoleBtn");
  if (clearRoleBtn) clearRoleBtn.addEventListener("click", clearRole);
  document.getElementById("restockToggleBtn").addEventListener("click", toggleRestockOnly);
  safeOn("resetDemoBtn", "click", resetDemoData);

  document.getElementById("stockSearchInput").addEventListener("input", () => {
    renderAutocomplete("stockSearchInput", "autocompleteList", selectStockItem);
  });

  document.getElementById("updateStockBtn").addEventListener("click", updateStock);
  safeOn("quickStockSearchInput", "input", () => {
    renderAutocomplete("quickStockSearchInput", "quickAutocompleteList", selectQuickStockItem);
  });
  safeOn("quickUpdateStockBtn", "click", quickUpdateStock);
  safeOn("manualOrderItemSearch", "input", () => {
    renderAutocomplete("manualOrderItemSearch", "manualOrderAutocompleteList", selectManualOrderItem);
  });
  safeOn("addManualOrderBtn", "click", addManualOrder);
  document.getElementById("addItemManageBtn").addEventListener("click", addNewItemFromManage);
  document.getElementById("itemManageSearch").addEventListener("input", renderItemManageTable);

  document.getElementById("mappingItemSearch").addEventListener("input", () => {
    document.getElementById("mappingItemSelect").value = "";
    renderAutocomplete("mappingItemSearch", "mappingAutocompleteList", selectMappingItem);
  });

  document.getElementById("addMappingBtn").addEventListener("click", addMapping);

  document.getElementById("costYearSelect").addEventListener("change", event => {
    selectedCostYear = event.target.value;
    renderCostReport();
  });

  document.getElementById("confirmPasswordBtn").addEventListener("click", confirmPassword);
  document.getElementById("cancelPasswordBtn").addEventListener("click", cancelPassword);
  document.getElementById("passwordInput").addEventListener("keydown", event => {
    if (event.key === "Enter") confirmPassword();
  });

  document.getElementById("closeEditOrderBtn").addEventListener("click", () => closeModal("editOrderModal"));
  document.getElementById("saveEditOrderBtn").addEventListener("click", saveEditOrder);

  document.getElementById("closeEditItemBtn").addEventListener("click", () => closeModal("editItemModal"));
  document.getElementById("saveEditItemBtn").addEventListener("click", saveEditItem);

  document.getElementById("closeDeleteItemBtn").addEventListener("click", () => closeModal("deleteItemModal"));
  document.getElementById("confirmDeleteItemBtn").addEventListener("click", confirmDeleteItem);
}

function safeOn(id, eventName, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(eventName, handler);
}

document.addEventListener("DOMContentLoaded", () => {
  initRole();
  bindEvents();
  renderAll();
});


// mobile UX hint
if(window.innerWidth < 640){
  console.log("手機版顯示啟用");
}


// v8.10：強制綁定叫貨紀錄搜尋按鈕，避免按搜尋沒反應
document.addEventListener("DOMContentLoaded", () => {
  const applyBtn = document.getElementById("applyOrderFilterBtn");
  const searchInput = document.getElementById("orderSearchInput");
  const monthSelect = document.getElementById("orderMonthFilter");
  const personSelect = document.getElementById("orderPersonFilter");
  const resetBtn = document.getElementById("resetOrderFilterBtn");

  if (applyBtn) {
    applyBtn.onclick = applyOrderFilters;
  }

  if (searchInput) {
    searchInput.onkeydown = (event) => {
      if (event.key === "Enter") applyOrderFilters();
    };
  }

  if (monthSelect) {
    monthSelect.onchange = (event) => {
      orderMonthFilterValue = event.target.value;
    };
  }

  if (personSelect) {
    personSelect.onchange = (event) => {
      orderPersonFilterValue = event.target.value;
    };
  }

  if (resetBtn) {
    resetBtn.onclick = resetOrderFilters;
  }
});


window.addEventListener("gb-role-ready", () => {
  initRole();
  renderAll();
  bindScreenshotPreview();
  startRemoteSync();
});


/* v13：同步啟動保險與 Console 測試用全域函式 */
(function exposeAndBootFirestoreSync(){
  function expose(){
    if (typeof startRemoteSync === "function") window.startRemoteSync = startRemoteSync;
    if (typeof queueRemoteSave === "function") window.queueRemoteSave = queueRemoteSave;
    if (typeof bindScreenshotPreview === "function") window.bindScreenshotPreview = bindScreenshotPreview;
    window.saveDataToFirebase = function(){
      if (typeof queueRemoteSave === "function") {
        queueRemoteSave();
        return "queued";
      }
      return "queueRemoteSave not found";
    };
  }

  function bootSyncIfReady(){
    expose();
    if (window.GB_AUTH && window.GB_AUTH.ready && window.GB_FIREBASE && window.GB_FIREBASE.ready) {
      try {
        if (typeof initRole === "function") initRole();
        if (typeof renderAll === "function") renderAll();
        if (typeof bindScreenshotPreview === "function") bindScreenshotPreview();
        if (typeof startRemoteSync === "function") startRemoteSync();
      } catch (error) {
        console.error("v13 Firestore sync boot failed:", error);
      }
    }
  }

  expose();
  window.addEventListener("gb-role-ready", bootSyncIfReady);
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(bootSyncIfReady, 300);
    setTimeout(bootSyncIfReady, 1200);
  });
})();


/* v13.3：Excel 匯出功能 */
function normalizeForExcel(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return value;
}

function getTransitQuantityForItem(itemId) {
  return (data.orders || [])
    .filter(order => order.itemId === itemId && order.status !== "done" && order.status !== "cancelled")
    .reduce((sum, order) => sum + (Number(order.qty) || 0), 0);
}

function getLatestCostForItem(itemId) {
  const rows = (data.orders || [])
    .filter(order => order.itemId === itemId && Number(order.cost) > 0)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return rows[0]?.cost || "";
}

function buildExcelRows() {
  const items = data.items || [];
  const orders = data.orders || [];
  const mappings = data.mappings || [];
  const history = data.history || [];

  const inventoryRows = items
    .filter(item => !item.disabled)
    .map(item => {
      const transitQty = getTransitQuantityForItem(item.id);
      const stock = Number(item.stock) || 0;
      const safety = Number(item.safety) || 0;
      return {
        "品項ID": item.id,
        "品項名稱": item.name,
        "分類": item.category || "",
        "管理部門": item.dept || "",
        "目前庫存": stock,
        "在途數量": transitQty,
        "安全庫存": safety,
        "狀態": item.disabled ? "停用" : "啟用",
        "是否需補貨": stock < safety ? "是" : "否",
        "建議補貨數": Math.max(safety - stock, 0),
        "最後更新人": item.lastUpdatedBy || "",
        "最後更新Email": item.lastUpdatedEmail || "",
        "最後更新時間": item.lastUpdatedAt ? formatDateTime(item.lastUpdatedAt) : "",
        "最後更新類型": item.lastUpdateType || "",
        "備註": item.note || ""
      };
    });

  const allItemRows = items.map(item => ({
    "品項ID": item.id,
    "品項名稱": item.name,
    "分類": item.category || "",
    "管理部門": item.dept || "",
    "目前庫存": Number(item.stock) || 0,
    "安全庫存": Number(item.safety) || 0,
    "狀態": item.disabled ? "停用" : "啟用",
    "最後更新人": item.lastUpdatedBy || "",
    "最後更新時間": item.lastUpdatedAt ? formatDateTime(item.lastUpdatedAt) : "",
    "備註": item.note || ""
  }));

  const transitRows = orders.map(order => {
    const item = items.find(row => row.id === order.itemId);
    return {
      "叫貨ID": order.id || "",
      "品項ID": order.itemId || "",
      "品項名稱": item?.name || order.itemName || "",
      "數量": Number(order.qty) || 0,
      "成本": Number(order.cost) || 0,
      "來源": order.source || "",
      "叫貨人": order.person || "",
      "叫貨日期": order.date || "",
      "狀態": order.status === "done" ? "已到貨" : "在途",
      "備註": order.note || ""
    };
  });

  const costRows = items.map(item => {
    const related = orders.filter(order => order.itemId === item.id && Number(order.cost) > 0);
    const totalCost = related.reduce((sum, order) => sum + (Number(order.cost) || 0), 0);
    const totalQty = related.reduce((sum, order) => sum + (Number(order.qty) || 0), 0);
    return {
      "品項ID": item.id,
      "品項名稱": item.name,
      "最近成本": getLatestCostForItem(item.id),
      "累計成本": totalCost,
      "累計數量": totalQty,
      "平均成本": totalQty ? Math.round((totalCost / totalQty) * 100) / 100 : ""
    };
  });

  const reorderRows = items
    .filter(item => !item.disabled && (Number(item.stock) || 0) < (Number(item.safety) || 0))
    .map(item => ({
      "品項ID": item.id,
      "品項名稱": item.name,
      "分類": item.category || "",
      "目前庫存": Number(item.stock) || 0,
      "安全庫存": Number(item.safety) || 0,
      "建議補貨數": Math.max((Number(item.safety) || 0) - (Number(item.stock) || 0), 0),
      "在途數量": getTransitQuantityForItem(item.id),
      "管理部門": item.dept || ""
    }));

  const mappingRows = mappings.map(mapping => ({
    "平台名稱/關鍵字": mapping.platform || mapping.raw || "",
    "對應內部品項": mapping.itemName || mapping.internal || "",
    "說明": mapping.note || ""
  }));

  const historyRows = history.map(record => ({
    "時間": record.time ? formatDateTime(record.time) : "",
    "品項ID": record.itemId || "",
    "品項名稱": record.itemName || "",
    "原庫存": normalizeForExcel(record.oldStock),
    "新庫存": normalizeForExcel(record.newStock),
    "異動": normalizeForExcel(record.change),
    "類型": record.type || "",
    "操作人": record.user || "",
    "Email": record.email || "",
    "備註": record.note || ""
  }));

  const infoRows = [{
    "匯出時間": formatDateTime(Date.now()),
    "匯出人": getCurrentUserLabel ? getCurrentUserLabel() : "",
    "匯出Email": getCurrentUserEmail ? getCurrentUserEmail() : "",
    "資料版本": "v13.3 Excel Export",
    "備註": "由金雀庫存管理系統自動匯出"
  }];

  return {
    "目前庫存": inventoryRows,
    "在途商品": transitRows,
    "成本": costRows,
    "補貨建議": reorderRows,
    "所有品項": allItemRows,
    "商品對應": mappingRows,
    "庫存異動": historyRows,
    "系統資訊": infoRows
  };
}

function autoFitWorksheetColumns(worksheet, rows) {
  const headers = Object.keys(rows[0] || {});
  worksheet["!cols"] = headers.map(header => {
    const maxLength = Math.max(
      header.length,
      ...rows.map(row => String(row[header] ?? "").length)
    );
    return { wch: Math.min(Math.max(maxLength + 2, 10), 32) };
  });
}

function exportInventoryExcel() {
  if (typeof XLSX === "undefined") {
    alert("Excel 匯出模組尚未載入完成，請重新整理後再試一次。");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheets = buildExcelRows();

  Object.entries(sheets).forEach(([sheetName, rows]) => {
    const safeRows = rows.length ? rows : [{ "資料": "目前沒有資料" }];
    const worksheet = XLSX.utils.json_to_sheet(safeRows);
    autoFitWorksheetColumns(worksheet, safeRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
  });

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  XLSX.writeFile(workbook, `金雀庫存總表_${stamp}.xlsx`);
}

function ensureExcelExportButton() {
  const adminPanel = document.getElementById("admin");
  if (!adminPanel || document.getElementById("exportExcelBtn")) return;

  const target = adminPanel.querySelector(".admin-grid") || adminPanel.querySelector(".card") || adminPanel;

  const buttonWrap = document.createElement("div");
  buttonWrap.className = "card excel-export-card";
  buttonWrap.innerHTML = `
    <h3>資料匯出</h3>
    <p class="note">匯出目前庫存、在途商品、成本、補貨建議、所有品項與異動紀錄。</p>
    <button id="exportExcelBtn" type="button">📥 匯出 Excel</button>
  `;

  if (target === adminPanel) {
    adminPanel.appendChild(buttonWrap);
  } else {
    target.insertAdjacentElement("beforebegin", buttonWrap);
  }

  document.getElementById("exportExcelBtn").addEventListener("click", exportInventoryExcel);
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(ensureExcelExportButton, 500);
  setTimeout(ensureExcelExportButton, 1500);
});

window.exportInventoryExcel = exportInventoryExcel;


/* v13.4：AI/OCR 採購辨識助手（免費版，不使用 Storage） */
let ocrParsedRows = [];

function ensureOcrStyles() {
  if (document.getElementById("ocrStyles")) return;
  const style = document.createElement("style");
  style.id = "ocrStyles";
  style.textContent = `
    .ocr-preview img{
      max-width:100%;
      border-radius:16px;
      border:1px solid var(--line);
      margin-top:12px;
    }
    .ocr-result-list{
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .ocr-row{
      display:grid;
      grid-template-columns:1.3fr 1.3fr .7fr .8fr .8fr;
      gap:10px;
      align-items:end;
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px;
      background:#fff;
    }
    .ocr-row .field{ margin:0; }
    .ocr-row .raw-text{
      grid-column:1/-1;
      color:var(--muted);
      font-size:13px;
      line-height:1.5;
    }
    .ocr-confidence{
      display:inline-flex;
      border-radius:999px;
      padding:4px 10px;
      background:#eef7f2;
      color:#2f7a4f;
      font-size:12px;
      margin-left:6px;
    }
    @media (max-width: 760px){
      .ocr-row{ grid-template-columns:1fr; }
      .ocr-row .raw-text{ grid-column:auto; }
    }
  `;
  document.head.appendChild(style);
}

function ensureOcrDateDefault() {
  const dateInput = document.getElementById("ocrDateInput");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

function getItemCandidatesFromText(text) {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, "");
  const candidates = (data.items || []).filter(item => !item.disabled).map(item => {
    const name = String(item.name || "").toLowerCase().replace(/\s+/g, "");
    let score = 0;

    if (normalized.includes(name)) score += 100;
    name.split(/[\/\-\(\)（）\s]+/).filter(Boolean).forEach(part => {
      if (part.length >= 2 && normalized.includes(part)) score += Math.min(part.length * 5, 25);
    });

    (data.mappings || []).forEach(mapping => {
      const keyword = String(mapping.platform || mapping.raw || "").toLowerCase().replace(/\s+/g, "");
      const internal = String(mapping.itemName || mapping.internal || "").toLowerCase().replace(/\s+/g, "");
      if ((internal && internal === name) || String(mapping.itemId || "") === item.id) {
        if (keyword && normalized.includes(keyword)) score += 120;
      }
    });

    return { item, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);

  return candidates;
}

function guessBestItem(text) {
  const candidates = getItemCandidatesFromText(text);
  return candidates[0]?.item || null;
}

function extractPrice(line) {
  const match = String(line).match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : "";
}

function extractQty(line) {
  const matches = [...String(line).matchAll(/[×xX]\s*([0-9]+)/g)];
  if (matches.length) return Number(matches[matches.length - 1][1]);
  const qtyMatch = String(line).match(/(?:数量|數量|qty|Qty|QTY)[:：\s]*([0-9]+)/);
  return qtyMatch ? Number(qtyMatch[1]) : "";
}

function cleanOcrLine(line) {
  return String(line || "")
    .replace(/退货包运费/g, "")
    .replace(/退貨包運費/g, "")
    .replace(/待收货|待收貨|待发货|待發貨|交易关闭|交易關閉|确认收货|確認收貨|查看物流|再次购买|再次購買/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOcrTextToRows(text) {
  const rawLines = String(text || "")
    .split(/\n+/)
    .map(cleanOcrLine)
    .filter(line => line && !/搜索|订单|全部|待付款|待发货|待收货|退款|评价|平台提醒|更多|总实付|總實付|包邮|包郵|含运费|含運費|已签收|已簽收/.test(line));

  const rows = [];
  let current = null;

  rawLines.forEach(line => {
    const price = extractPrice(line);
    const qty = extractQty(line);
    const likelyName = /[\u4e00-\u9fa5A-Za-z]/.test(line) && !/^颜色|顏色|规格|規格|材质|材質|尺寸/.test(line);

    if (price !== "" && qty !== "") {
      const nameText = current?.nameText || line.replace(/[¥￥]\s*[0-9]+(?:\.[0-9]+)?/g, "").replace(/[×xX]\s*[0-9]+/g, "");
      rows.push({
        rawText: [current?.rawText, line].filter(Boolean).join(" / "),
        nameText: cleanOcrLine(nameText),
        specText: current?.specText || "",
        qty,
        cost: price,
        itemId: guessBestItem(`${nameText} ${current?.specText || ""}`)?.id || "",
        confidence: guessBestItem(`${nameText} ${current?.specText || ""}`) ? "可能符合" : "需手動選擇"
      });
      current = null;
      return;
    }

    if (price !== "" && current) current.cost = price;
    if (qty !== "" && current) current.qty = qty;

    if (likelyName && !/[¥￥]\s*[0-9]/.test(line) && !/[×xX]\s*[0-9]/.test(line)) {
      if (current && current.nameText && (current.qty || current.cost)) {
        rows.push({
          rawText: current.rawText || current.nameText,
          nameText: current.nameText,
          specText: current.specText || "",
          qty: current.qty || "",
          cost: current.cost || "",
          itemId: guessBestItem(`${current.nameText} ${current.specText || ""}`)?.id || "",
          confidence: guessBestItem(`${current.nameText} ${current.specText || ""}`) ? "可能符合" : "需手動選擇"
        });
      }
      current = { nameText: line, rawText: line, specText: "", qty: "", cost: "" };
      return;
    }

    if (current) {
      current.rawText = `${current.rawText || ""} / ${line}`;
      if (/颜色|顏色|规格|規格|材质|材質|尺寸/.test(line)) {
        current.specText = [current.specText, line].filter(Boolean).join(" ");
      }
    }
  });

  if (current && current.nameText) {
    rows.push({
      rawText: current.rawText || current.nameText,
      nameText: current.nameText,
      specText: current.specText || "",
      qty: current.qty || "",
      cost: current.cost || "",
      itemId: guessBestItem(`${current.nameText} ${current.specText || ""}`)?.id || "",
      confidence: guessBestItem(`${current.nameText} ${current.specText || ""}`) ? "可能符合" : "需手動選擇"
    });
  }

  return rows.filter(row => row.nameText || row.qty || row.cost);
}

function renderOcrRows(rows) {
  const list = document.getElementById("ocrResultList");
  if (!list) return;

  ocrParsedRows = rows || [];

  if (!ocrParsedRows.length) {
    list.innerHTML = "尚無辨識結果。";
    return;
  }

  const itemOptions = (data.items || [])
    .filter(item => !item.disabled)
    .map(item => `<option value="${item.id}">${item.name}</option>`)
    .join("");

  list.innerHTML = ocrParsedRows.map((row, index) => {
    return `
      <div class="ocr-row" data-index="${index}">
        <div class="field">
          <label>辨識品名</label>
          <input class="ocr-name" value="${escapeHtml(row.nameText || "")}" />
        </div>
        <div class="field">
          <label>對應內部品項 <span class="ocr-confidence">${row.confidence || "需確認"}</span></label>
          <select class="ocr-item">
            <option value="">請選擇品項</option>
            ${itemOptions}
          </select>
        </div>
        <div class="field">
          <label>數量</label>
          <input class="ocr-qty" type="number" min="0" value="${row.qty || ""}" />
        </div>
        <div class="field">
          <label>單價/成本</label>
          <input class="ocr-cost" type="number" min="0" step="0.01" value="${row.cost || ""}" />
        </div>
        <div class="field">
          <label>規格/備註</label>
          <input class="ocr-note" value="${escapeHtml(row.specText || "")}" />
        </div>
        <div class="raw-text">原始文字：${escapeHtml(row.rawText || "")}</div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".ocr-row").forEach((el, index) => {
    const select = el.querySelector(".ocr-item");
    if (select && ocrParsedRows[index].itemId) select.value = ocrParsedRows[index].itemId;
  });
}

async function runOcrRecognition() {
  ensureOcrStyles();
  const input = document.getElementById("ocrImageInput");
  const output = document.getElementById("ocrTextOutput");
  const status = document.getElementById("ocrStatus");

  if (!input?.files?.[0]) {
    alert("請先選擇圖片。");
    return;
  }

  if (typeof Tesseract === "undefined") {
    alert("OCR 模組尚未載入完成，請重新整理後再試一次。");
    return;
  }

  status.textContent = "辨識中，請稍候…第一次載入可能需要 10～30 秒。";

  try {
    const result = await Tesseract.recognize(input.files[0], "chi_sim+chi_tra+eng", {
      logger: message => {
        if (message.status === "recognizing text") {
          status.textContent = `辨識中… ${Math.round((message.progress || 0) * 100)}%`;
        }
      }
    });

    const text = result?.data?.text || "";
    output.value = text;
    status.textContent = "辨識完成，請檢查文字後按「解析文字成品項」。";
    renderOcrRows(parseOcrTextToRows(text));
  } catch (error) {
    console.error(error);
    status.textContent = "辨識失敗，請換一張較清楚的截圖，或手動貼上文字測試。";
  }
}

function parseOcrTextFromTextarea() {
  const text = document.getElementById("ocrTextOutput")?.value || "";
  renderOcrRows(parseOcrTextToRows(text));
}

function previewOcrImage() {
  const input = document.getElementById("ocrImageInput");
  const preview = document.getElementById("ocrImagePreview");
  if (!input?.files?.[0] || !preview) return;
  const url = URL.createObjectURL(input.files[0]);
  preview.innerHTML = `<img src="${url}" alt="OCR 預覽圖" />`;
}

function clearOcrAssistant() {
  const image = document.getElementById("ocrImageInput");
  const preview = document.getElementById("ocrImagePreview");
  const output = document.getElementById("ocrTextOutput");
  const list = document.getElementById("ocrResultList");
  const status = document.getElementById("ocrStatus");

  if (image) image.value = "";
  if (preview) preview.innerHTML = "";
  if (output) output.value = "";
  if (list) list.innerHTML = "尚無辨識結果。";
  if (status) status.textContent = "尚未辨識。";
  ocrParsedRows = [];
}

function confirmOcrOrders() {
  const list = document.getElementById("ocrResultList");
  if (!list) return;

  const source = document.getElementById("ocrSourceInput")?.value.trim() || "OCR辨識";
  const date = document.getElementById("ocrDateInput")?.value || new Date().toISOString().slice(0, 10);
  const rows = [...list.querySelectorAll(".ocr-row")];

  let added = 0;

  rows.forEach(row => {
    const itemId = row.querySelector(".ocr-item")?.value || "";
    const qty = Number(row.querySelector(".ocr-qty")?.value || 0);
    const cost = Number(row.querySelector(".ocr-cost")?.value || 0);
    const note = row.querySelector(".ocr-note")?.value || "";
    const rawName = row.querySelector(".ocr-name")?.value || "";

    if (!itemId || !qty) return;

    const item = data.items.find(item => item.id === itemId);
    if (!item) return;

    data.orders.unshift({
      id: `O${Date.now()}${Math.floor(Math.random() * 1000)}`,
      itemId,
      itemName: item.name,
      qty,
      cost,
      source,
      person: getCurrentUserLabel ? getCurrentUserLabel() : "",
      date,
      status: "pending",
      note: [rawName, note, "OCR建立"].filter(Boolean).join("｜")
    });

    added += 1;
  });

  if (!added) {
    alert("沒有可加入的品項。請確認已選擇內部品項並填入數量。");
    return;
  }

  saveData();
  renderAll();
  alert(`已加入 ${added} 筆在途商品。`);
}

function bindOcrAssistant() {
  ensureOcrStyles();
  ensureOcrDateDefault();

  const imageInput = document.getElementById("ocrImageInput");
  const runBtn = document.getElementById("runOcrBtn");
  const parseBtn = document.getElementById("parseOcrTextBtn");
  const clearBtn = document.getElementById("clearOcrBtn");
  const confirmBtn = document.getElementById("confirmOcrOrdersBtn");

  if (imageInput && !imageInput.dataset.bound) {
    imageInput.addEventListener("change", previewOcrImage);
    imageInput.dataset.bound = "true";
  }
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.addEventListener("click", runOcrRecognition);
    runBtn.dataset.bound = "true";
  }
  if (parseBtn && !parseBtn.dataset.bound) {
    parseBtn.addEventListener("click", parseOcrTextFromTextarea);
    parseBtn.dataset.bound = "true";
  }
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.addEventListener("click", clearOcrAssistant);
    clearBtn.dataset.bound = "true";
  }
  if (confirmBtn && !confirmBtn.dataset.bound) {
    confirmBtn.addEventListener("click", confirmOcrOrders);
    confirmBtn.dataset.bound = "true";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(bindOcrAssistant, 500);
  setTimeout(bindOcrAssistant, 1500);
});

window.runOcrRecognition = runOcrRecognition;
window.parseOcrTextToRows = parseOcrTextToRows;


/* v14：正式整合版診斷 */
window.GB_VERSION = "v14-official-integrated";
function gbDiagnostic() {
  return {
    version: window.GB_VERSION,
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    currentRole: window.GB_AUTH?.role,
    currentUser: window.GB_AUTH?.user,
    hasOcrTab: !!document.querySelector('[data-tab="ocr"]'),
    hasOcrPanel: !!document.getElementById("ocr"),
    currentTab
  };
}
window.gbDiagnostic = gbDiagnostic;


/* GoldenBird Inventory v1.1 Stable */
window.GB_VERSION = "goldenbird-inventory-v1.1-stable";

function ensureV11StableStyles() {
  if (document.getElementById("v11StableStyles")) return;
  const style = document.createElement("style");
  style.id = "v11StableStyles";
  style.textContent = `
    [data-tab="ocr"],#ocr,#resetDemoBtn,.mapping-section,#orderScreenshotInput,#screenshotPreview{display:none!important}
    #adminContent .order-section,#adminContent .admin-section{width:100%;box-sizing:border-box}
    #adminContent .order-input-grid{display:grid;grid-template-columns:1fr!important;gap:18px;width:100%}
    #adminContent .order-input-grid>.card{width:100%;box-sizing:border-box}
    .quick-stock-btn{margin-top:6px;padding:5px 9px;font-size:12px;border-radius:999px}
    .inventory-row.status-good{background:#fff}.inventory-row.status-warn{background:#fffaf0}.inventory-row.status-bad{background:#fff3f0}.inventory-row.status-info{background:#f1f8fb}
    @media(max-width:760px){
      #inventoryGrid .inventory-list{display:flex;flex-direction:column;gap:8px}
      #inventoryGrid .inventory-row.header{display:none!important}
      #inventoryGrid .inventory-row{display:grid!important;grid-template-columns:1fr auto;grid-template-areas:"name status" "numbers action";gap:6px 8px;padding:9px 11px!important;border-radius:14px;min-height:auto!important}
      #inventoryGrid .inventory-name{grid-area:name;min-width:0}
      #inventoryGrid .inventory-name strong{display:block;font-size:15.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #inventoryGrid .meta-tags{display:flex;flex-wrap:nowrap;gap:5px;margin-top:4px;overflow:hidden}
      #inventoryGrid .meta-tag{font-size:11px;padding:3px 7px;white-space:nowrap;max-width:86px;overflow:hidden;text-overflow:ellipsis}
      #inventoryGrid .meta-tag:nth-child(n+4){display:none}
      #inventoryGrid .inventory-row>div:nth-child(5){grid-area:status;align-self:start;justify-self:end}
      #inventoryGrid .inventory-row>div:nth-child(2),#inventoryGrid .inventory-row>div:nth-child(3),#inventoryGrid .inventory-row>div:nth-child(4),#inventoryGrid .inventory-row>div:nth-child(6){grid-area:numbers}
      #inventoryGrid .inventory-row>div:nth-child(2){justify-self:start}
      #inventoryGrid .inventory-row>div:nth-child(3){justify-self:start;margin-left:68px}
      #inventoryGrid .inventory-row>div:nth-child(4){justify-self:start;margin-left:136px}
      #inventoryGrid .inventory-row>div:nth-child(6){justify-self:start;margin-left:204px}
      #inventoryGrid .stock-cell::before{content:"庫 ";color:var(--muted);font-weight:600}
      #inventoryGrid .incoming-cell::before{content:"途 ";color:var(--muted);font-weight:600}
      #inventoryGrid .safety-cell::before{content:"安 ";color:var(--muted);font-weight:600}
      #inventoryGrid .suggest-cell::before{content:"補 ";color:var(--muted);font-weight:600}
      #inventoryGrid .num-cell,#inventoryGrid .suggest-cell{font-size:13.5px;line-height:1.4}
      #inventoryGrid .badge{font-size:12px;padding:4px 8px;white-space:nowrap}
      #inventoryGrid .quick-stock-btn{grid-area:action;justify-self:end;align-self:end;margin-top:0;padding:4px 8px;font-size:11.5px}
      #inventoryGrid .safety-input{width:44px!important;padding:2px 4px!important;font-size:13px!important;text-align:center}
    }`;
  document.head.appendChild(style);
}

function removeV11UnusedUI(){
  document.querySelector('[data-tab="ocr"]')?.remove();
  document.getElementById("ocr")?.remove();
  document.getElementById("resetDemoBtn")?.remove();
  document.querySelector(".mapping-section")?.remove();
  document.getElementById("orderScreenshotInput")?.closest(".card")?.remove();
  if(currentTab==="ocr") switchTab("overview");
}

getStatus = function(item){
  const incoming=getIncomingQty(item.id);
  const stock=Number(item.stock)||0;
  const safety=Number(item.safety)||0;
  if(stock===0 && incoming<=0) return {text:"缺貨",type:"bad"};
  if(stock<safety && incoming>0) return {text:"已叫貨",type:"info"};
  if(stock<=safety) return {text:"注意補貨",type:"warn"};
  return {text:"正常",type:"good"};
};

function openQuickStockModal(itemId){
  const item=getItem(itemId); if(!item) return;
  document.getElementById("quickStockItemId").value=item.id;
  document.getElementById("quickStockItemText").textContent=item.name;
  document.getElementById("quickStockOldQty").value=item.stock;
  document.getElementById("quickStockNewQty").value=item.stock;
  document.getElementById("quickStockReason").value="盤點更新";
  openModal("quickStockModal");
}

function confirmQuickStockUpdate(){
  const item=getItem(document.getElementById("quickStockItemId").value);
  const qty=Number(document.getElementById("quickStockNewQty").value);
  const reason=document.getElementById("quickStockReason").value||"盤點更新";
  if(!item || Number.isNaN(qty) || qty<0){showToast("請輸入正確庫存數量");return;}
  const oldStock=Number(item.stock)||0;
  item.stock=qty;
  addStockHistory(item,oldStock,qty,reason);
  lastUpdatedItemId=item.id;
  saveData();
  closeModal("quickStockModal");
  renderAll();
  showToast(`${item.name} 已更新為 ${qty}`);
}

const gbV11RenderInventory=renderInventory;
renderInventory=function(){
  gbV11RenderInventory();
  const role=document.getElementById("roleSelect")?.value||"staff";
  const canQuickEdit=role==="process"||role==="boss"||role==="qing"||role==="emily";
  document.querySelectorAll("#inventoryGrid .inventory-row:not(.header)").forEach(row=>{
    const name=row.querySelector(".inventory-name strong")?.textContent||"";
    const item=data.items.find(i=>i.name===name && !i.disabled);
    if(!item) return;
    row.classList.add(`status-${getStatus(item).type}`);
    if(canQuickEdit && !row.querySelector(".quick-stock-btn")){
      const btn=document.createElement("button");
      btn.type="button"; btn.className="secondary small quick-stock-btn"; btn.textContent="盤點";
      btn.addEventListener("click",()=>openQuickStockModal(item.id));
      row.appendChild(btn);
    }
  });
};

createNewItem=function({name,category,safety,dept,note,shared,stock}){
  if(!name){showToast("請輸入品項名稱");return;}
  const initialStock=Number(stock)||0;
  const newItem={
    id:`I${Date.now()}`,name,category,stock:initialStock,safety:Number(safety)||0,
    dept:dept||category,mode:shared?"共用型":"觀察型",note:note||"",disabled:false,
    createdAt:Date.now(),lastUpdatedBy:getCurrentUserLabel(),lastUpdatedEmail:getCurrentUserEmail(),
    lastUpdatedAt:Date.now(),lastUpdateType:"新增品項"
  };
  data.items.push(newItem); lastCreatedItemId=newItem.id; autoSelectNewItemInSearchFields(newItem);
  if(initialStock>0) addStockHistory(newItem,0,initialStock,"新增品項初始庫存");
  saveData(); renderAll(); showToast("新品項已新增");
};

addNewItemFromManage=function(){
  const name=document.getElementById("newItemNameManage").value.trim();
  const categoryInput=document.getElementById("newCategoryInput").value.trim();
  const categorySelect=document.getElementById("newItemCategoryManage");
  const category=categoryInput||categorySelect.value;
  const safety=Number(document.getElementById("newItemSafetyManage").value)||0;
  const stock=Number(document.getElementById("newItemStockManage")?.value||0)||0;
  const dept=document.getElementById("newItemDeptManage").value.trim()||category;
  if(categoryInput && ![...categorySelect.options].some(o=>o.value===categoryInput)){categorySelect.appendChild(new Option(categoryInput,categoryInput));categorySelect.value=categoryInput;}
  const note=document.getElementById("newItemNoteManage").value.trim();
  const shared=document.getElementById("newItemSharedManage").checked;
  createNewItem({name,category,safety,dept,note,shared,stock});
  ["newItemNameManage","newItemSafetyManage","newItemStockManage","newItemDeptManage","newItemNoteManage","newCategoryInput"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";});
  document.getElementById("newItemSharedManage").checked=false;
};

document.addEventListener("DOMContentLoaded",()=>{
  ensureV11StableStyles(); removeV11UnusedUI();
  document.getElementById("cancelQuickStockBtn")?.addEventListener("click",()=>closeModal("quickStockModal"));
  document.getElementById("confirmQuickStockBtn")?.addEventListener("click",confirmQuickStockUpdate);
});

const gbV11RenderAll=renderAll;
renderAll=function(){gbV11RenderAll();ensureV11StableStyles();removeV11UnusedUI();};

window.gbDiagnostic=function(){return {version:window.GB_VERSION,firebaseReady:!!window.GB_FIREBASE?.ready,authReady:!!window.GB_AUTH?.ready,currentRole:window.GB_AUTH?.role,currentUser:window.GB_AUTH?.user,currentTab};};


/* GoldenBird Inventory v1.1.1｜快速盤點按鈕視覺優化 */
window.GB_VERSION = "goldenbird-inventory-v1.1.1-compact-audit-button";

function ensureCompactAuditButtonStyles() {
  if (document.getElementById("compactAuditButtonStyles")) return;

  const style = document.createElement("style");
  style.id = "compactAuditButtonStyles";
  style.textContent = `
    #inventoryGrid .inventory-row {
      position: relative;
    }

    #inventoryGrid .quick-stock-btn {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      padding: 0 !important;
      border-radius: 999px !important;
      font-size: 0 !important;
      line-height: 1 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: #ffffff !important;
      border: 1px solid var(--line) !important;
      color: var(--text) !important;
      box-shadow: 0 4px 12px rgba(0,0,0,.06);
      opacity: .55;
      transition: opacity .18s ease, transform .18s ease, background .18s ease;
    }

    #inventoryGrid .quick-stock-btn::before {
      content: "✏️";
      font-size: 14px;
      line-height: 1;
    }

    #inventoryGrid .inventory-row:hover .quick-stock-btn {
      opacity: 1;
      transform: translateY(-1px);
      background: #f8fbfb !important;
    }

    @media (min-width: 761px) {
      #inventoryGrid .quick-stock-btn {
        position: absolute;
        right: 14px;
        bottom: 12px;
      }

      #inventoryGrid .inventory-row {
        padding-bottom: 18px !important;
      }
    }

    @media (max-width: 760px) {
      #inventoryGrid .inventory-row {
        grid-template-columns: 1fr auto;
        grid-template-areas:
          "name status"
          "numbers action" !important;
      }

      #inventoryGrid .quick-stock-btn {
        grid-area: action !important;
        justify-self: end !important;
        align-self: center !important;
        margin: 0 !important;
        width: 30px !important;
        height: 30px !important;
        min-width: 30px !important;
        opacity: .75;
      }

      #inventoryGrid .quick-stock-btn::before {
        font-size: 13px;
      }
    }
  `;
  document.head.appendChild(style);
}

document.addEventListener("DOMContentLoaded", () => {
  ensureCompactAuditButtonStyles();
});

const gbCompactAuditRenderAll = renderAll;
renderAll = function() {
  gbCompactAuditRenderAll();
  ensureCompactAuditButtonStyles();
};


function normalizeQuickStockButtons() {
  document.querySelectorAll("#inventoryGrid .quick-stock-btn").forEach(btn => {
    btn.textContent = "";
    btn.title = "快速盤點";
    btn.setAttribute("aria-label", "快速盤點");
  });
}

const gbCompactAuditRenderInventory = renderInventory;
renderInventory = function() {
  gbCompactAuditRenderInventory();
  normalizeQuickStockButtons();
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(normalizeQuickStockButtons, 300);
});


/* GoldenBird Inventory v1.2 Stable｜正式版介面優化 */
window.GB_VERSION = "goldenbird-inventory-v1.2-stable-ui-polish";

function ensureV12PolishStyles() {
  if (document.getElementById("v12PolishStyles")) return;

  const style = document.createElement("style");
  style.id = "v12PolishStyles";
  style.textContent = `
    .duplicate-hint {
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 14px;
      background: #fff8e8;
      color: #6d5a2b;
      font-size: 13px;
      line-height: 1.55;
      border: 1px solid #f1dfb8;
    }
    .duplicate-hint.hidden {
      display: none;
    }
    .duplicate-hint strong {
      color: #344f55;
    }
    .duplicate-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 4px 4px 0 0;
      padding: 4px 8px;
      border-radius: 999px;
      background: #fff;
      border: 1px solid #ead9ae;
      color: #344f55;
      font-size: 12px;
    }
    .duplicate-hint.is-error {
      background: #fff1ed;
      border-color: #efc5b7;
      color: #8b3a2a;
    }
  `;
  document.head.appendChild(style);
}

function normalizeItemNameForDuplicate(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]{}「」『』\-＿_\/\\,，.。:：;；]/g, "");
}

function findDuplicateItemsByName(name) {
  const normalized = normalizeItemNameForDuplicate(name);
  if (!normalized) return { exact: null, similar: [] };

  const activeItems = (data.items || []).filter(item => !item.disabled);
  const exact = activeItems.find(item => normalizeItemNameForDuplicate(item.name) === normalized) || null;

  const similar = activeItems
    .filter(item => item !== exact)
    .map(item => {
      const itemName = normalizeItemNameForDuplicate(item.name);
      let score = 0;
      if (itemName.includes(normalized) || normalized.includes(itemName)) score += 80;
      [...new Set(normalized.split(""))].forEach(ch => {
        if (itemName.includes(ch)) score += 1;
      });
      return { item, score };
    })
    .filter(row => row.score >= 4 || normalizeItemNameForDuplicate(row.item.name).includes(normalized.slice(0, 2)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(row => row.item);

  return { exact, similar };
}

function updateNewItemDuplicateHint() {
  const input = document.getElementById("newItemNameManage");
  const hint = document.getElementById("newItemDuplicateHint");
  if (!input || !hint) return;

  const name = input.value.trim();
  if (!name) {
    hint.classList.add("hidden");
    hint.classList.remove("is-error");
    hint.innerHTML = "";
    return;
  }

  const { exact, similar } = findDuplicateItemsByName(name);

  if (exact) {
    hint.classList.remove("hidden");
    hint.classList.add("is-error");
    hint.innerHTML = `⚠️ 已存在相同品項：<strong>${escapeHtml(exact.name)}</strong>。請勿重複新增，可直接到庫存總覽搜尋此品項。`;
    return;
  }

  if (similar.length) {
    hint.classList.remove("hidden");
    hint.classList.remove("is-error");
    hint.innerHTML = `可能相關的既有品項：<br>${similar.map(item => `<span class="duplicate-chip">${escapeHtml(item.name)}</span>`).join("")}`;
    return;
  }

  hint.classList.add("hidden");
  hint.classList.remove("is-error");
  hint.innerHTML = "";
}

const gbV12CreateNewItem = createNewItem;
createNewItem = function(payload) {
  const name = payload?.name || "";
  const { exact } = findDuplicateItemsByName(name);
  if (exact) {
    showToast(`已存在相同品項：${exact.name}`);
    updateNewItemDuplicateHint();
    return;
  }
  gbV12CreateNewItem(payload);
};

const gbV12AddNewItemFromManage = addNewItemFromManage;
addNewItemFromManage = function() {
  const nameInput = document.getElementById("newItemNameManage");
  const name = nameInput?.value.trim() || "";
  const { exact } = findDuplicateItemsByName(name);

  if (exact) {
    showToast(`已存在相同品項：${exact.name}`);
    updateNewItemDuplicateHint();
    nameInput?.focus();
    return;
  }

  const previousCategory = document.getElementById("newItemCategoryManage")?.value || "";
  const previousDept = document.getElementById("newItemDeptManage")?.value || "";
  const previousShared = document.getElementById("newItemSharedManage")?.checked || false;

  gbV12AddNewItemFromManage();

  // 大量新增時保留分類、部門、共用設定，只清空品名/初始庫存/安全庫存/備註
  const categorySelect = document.getElementById("newItemCategoryManage");
  const deptInput = document.getElementById("newItemDeptManage");
  const sharedInput = document.getElementById("newItemSharedManage");
  if (categorySelect && previousCategory) categorySelect.value = previousCategory;
  if (deptInput && previousDept) deptInput.value = previousDept;
  if (sharedInput) sharedInput.checked = previousShared;

  document.getElementById("newItemNameManage")?.focus();
  updateNewItemDuplicateHint();
};

function removeV12ObsoleteText() {
  document.querySelectorAll(".badge, .note").forEach(el => {
    const text = (el.textContent || "").trim();
    if (
      text.includes("上傳截圖或手動新增") ||
      text.includes("目前資料存在瀏覽器") ||
      text.includes("正式版會改接 Firebase") ||
      text.includes("若輸入錯誤，可以再次搜尋同一品項")
    ) {
      el.remove();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ensureV12PolishStyles();
  removeV12ObsoleteText();

  const nameInput = document.getElementById("newItemNameManage");
  if (nameInput && nameInput.dataset.duplicateBound !== "true") {
    nameInput.addEventListener("input", updateNewItemDuplicateHint);
    nameInput.addEventListener("blur", updateNewItemDuplicateHint);
    nameInput.dataset.duplicateBound = "true";
  }
});

const gbV12RenderAll = renderAll;
renderAll = function() {
  gbV12RenderAll();
  ensureV12PolishStyles();
  removeV12ObsoleteText();
  updateNewItemDuplicateHint();
};

window.gbDiagnostic = function() {
  return {
    version: window.GB_VERSION,
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    currentRole: window.GB_AUTH?.role,
    currentUser: window.GB_AUTH?.user,
    currentTab
  };
};


/* GoldenBird Inventory v2.0 Stable｜正式版架構 */
window.GB_VERSION = "goldenbird-inventory-v2.0-stable";

let historySearchKeyword = "";
let historyLimitValue = "20";

function ensureV20Styles() {
  if (document.getElementById("v20Styles")) return;
  const style = document.createElement("style");
  style.id = "v20Styles";
  style.textContent = `
    [data-tab="ocr"],#ocr,#update,#resetDemoBtn,.mapping-section,#orderScreenshotInput,#screenshotPreview{display:none!important}
    #adminContent .order-section,#adminContent .admin-section{width:100%;box-sizing:border-box}
    #adminContent .order-input-grid{display:grid;grid-template-columns:1fr!important;gap:18px;width:100%}
    #adminContent .order-input-grid>.card{width:100%;box-sizing:border-box}
    .quick-stock-btn{width:32px!important;height:32px!important;min-width:32px!important;padding:0!important;border-radius:999px!important;font-size:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:#fff!important;border:1px solid var(--line)!important;box-shadow:0 4px 12px rgba(0,0,0,.06);opacity:.62}
    .quick-stock-btn::before{content:"✏️";font-size:14px}
    .inventory-row{position:relative}
    .inventory-row:hover .quick-stock-btn{opacity:1;background:#f8fbfb!important}
    .inventory-row.status-good{background:#fff}.inventory-row.status-warn{background:#fffaf0}.inventory-row.status-bad{background:#fff3f0}.inventory-row.status-info{background:#f1f8fb}
    .history-card{border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:10px;background:#fff}
    .history-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;font-weight:700}
    .history-meta{color:var(--muted);font-size:13px;margin-top:6px;line-height:1.6}
    .history-change{font-size:15px;margin-top:8px}
    .history-arrow{padding:0 6px;color:var(--muted)}
    @media(min-width:761px){#inventoryGrid .quick-stock-btn{position:absolute;right:14px;bottom:12px}}
    @media(max-width:760px){
      #inventoryGrid .inventory-list{display:flex;flex-direction:column;gap:8px}
      #inventoryGrid .inventory-row.header{display:none!important}
      #inventoryGrid .inventory-row{display:grid!important;grid-template-columns:1fr auto;grid-template-areas:"name status" "numbers action";gap:6px 8px;padding:9px 11px!important;border-radius:14px;min-height:auto!important}
      #inventoryGrid .inventory-name{grid-area:name;min-width:0}
      #inventoryGrid .inventory-name strong{display:block;font-size:15.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #inventoryGrid .meta-tags{display:flex;flex-wrap:nowrap;gap:5px;margin-top:4px;overflow:hidden}
      #inventoryGrid .meta-tag{font-size:11px;padding:3px 7px;white-space:nowrap;max-width:86px;overflow:hidden;text-overflow:ellipsis}
      #inventoryGrid .meta-tag:nth-child(n+4){display:none}
      #inventoryGrid .inventory-row>div:nth-child(5){grid-area:status;align-self:start;justify-self:end}
      #inventoryGrid .inventory-row>div:nth-child(2),#inventoryGrid .inventory-row>div:nth-child(3),#inventoryGrid .inventory-row>div:nth-child(4),#inventoryGrid .inventory-row>div:nth-child(6){grid-area:numbers}
      #inventoryGrid .inventory-row>div:nth-child(2){justify-self:start}
      #inventoryGrid .inventory-row>div:nth-child(3){justify-self:start;margin-left:68px}
      #inventoryGrid .inventory-row>div:nth-child(4){justify-self:start;margin-left:136px}
      #inventoryGrid .inventory-row>div:nth-child(6){justify-self:start;margin-left:204px}
      #inventoryGrid .stock-cell::before{content:"庫 ";color:var(--muted);font-weight:600}
      #inventoryGrid .incoming-cell::before{content:"途 ";color:var(--muted);font-weight:600}
      #inventoryGrid .safety-cell::before{content:"安 ";color:var(--muted);font-weight:600}
      #inventoryGrid .suggest-cell::before{content:"補 ";color:var(--muted);font-weight:600}
      #inventoryGrid .num-cell,#inventoryGrid .suggest-cell{font-size:13.5px;line-height:1.4}
      #inventoryGrid .badge{font-size:12px;padding:4px 8px;white-space:nowrap}
      #inventoryGrid .quick-stock-btn{grid-area:action;justify-self:end;align-self:center;margin:0!important;width:30px!important;height:30px!important;min-width:30px!important}
    }`;
  document.head.appendChild(style);
}

function removeV20UnusedUI(){
  document.querySelector('[data-tab="ocr"]')?.remove();
  document.querySelector('[data-tab="update"]')?.remove();
  document.getElementById("ocr")?.remove();
  document.getElementById("update")?.remove();
  document.getElementById("resetDemoBtn")?.remove();
  document.querySelector(".mapping-section")?.remove();
  document.getElementById("orderScreenshotInput")?.closest(".card")?.remove();
  if(currentTab==="ocr"||currentTab==="update") switchTab("overview");
}

getStatus=function(item){
  const incoming=getIncomingQty(item.id);
  const stock=Number(item.stock)||0;
  const safety=Number(item.safety)||0;
  if(stock===0 && incoming<=0) return {text:"缺貨",type:"bad"};
  if(stock<safety && incoming>0) return {text:"已叫貨",type:"info"};
  if(stock<=safety) return {text:"注意補貨",type:"warn"};
  return {text:"正常",type:"good"};
};

renderIncoming=function(){
  const tbody=document.getElementById("incomingTable");
  if(!tbody) return;
  const activeOrders=data.orders.filter(order=>Number(order.qty)-Number(order.received)>0);
  tbody.innerHTML=activeOrders.map(order=>{
    const item=getItem(order.itemId);
    const remain=Math.max(0,Number(order.qty)-Number(order.received));
    const statusClass=order.status==="部分到貨"?"warn":"info";
    return `<tr class="${order.id===lastCreatedOrderId?"highlight-row":""}">
      <td>${order.date||""}</td>
      <td>${item?item.name:(order.deletedItemName||"已刪除品項")}</td>
      <td>${order.qty}</td>
      <td>${order.received}</td>
      <td>${remain}</td>
      <td>NT$ ${order.cost||0}</td>
      <td>${order.person||"-"}</td>
      <td><span class="badge ${statusClass}">${order.status}</span></td>
      <td><input class="receive-input" data-id="${order.id}" type="number" min="1" max="${remain}" placeholder="數量" style="width:90px;"></td>
      <td><button class="small receive-btn" data-id="${order.id}">確認到貨</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">目前沒有在途商品</td></tr>`;
  document.querySelectorAll(".receive-btn").forEach(button=>{
    button.addEventListener("click",()=>receiveOrder(button.dataset.id));
  });
};

function openQuickStockModal(itemId){
  const item=getItem(itemId); if(!item) return;
  document.getElementById("quickStockItemId").value=item.id;
  document.getElementById("quickStockItemText").textContent=item.name;
  document.getElementById("quickStockOldQty").value=item.stock;
  document.getElementById("quickStockNewQty").value=item.stock;
  document.getElementById("quickStockReason").value="盤點更新";
  const custom=document.getElementById("quickStockCustomReason"); if(custom) custom.value="";
  openModal("quickStockModal");
}

function confirmQuickStockUpdate(){
  const item=getItem(document.getElementById("quickStockItemId").value);
  const qty=Number(document.getElementById("quickStockNewQty").value);
  const reasonBase=document.getElementById("quickStockReason").value||"盤點更新";
  const custom=document.getElementById("quickStockCustomReason")?.value.trim();
  const reason=custom || reasonBase;
  if(!item || Number.isNaN(qty) || qty<0){showToast("請輸入正確庫存數量");return;}
  const oldStock=Number(item.stock)||0;
  item.stock=qty;
  addStockHistory(item,oldStock,qty,reason);
  lastUpdatedItemId=item.id;
  saveData(); closeModal("quickStockModal"); renderAll();
  showToast(`${item.name} 已更新為 ${qty}`);
}

const gbV20RenderInventory=renderInventory;
renderInventory=function(){
  gbV20RenderInventory();
  const role=document.getElementById("roleSelect")?.value||"staff";
  const canQuickEdit=role==="process"||role==="boss"||role==="qing"||role==="emily";
  document.querySelectorAll("#inventoryGrid .inventory-row:not(.header)").forEach(row=>{
    const name=row.querySelector(".inventory-name strong")?.textContent||"";
    const item=data.items.find(i=>i.name===name && !i.disabled);
    if(!item) return;
    row.classList.add(`status-${getStatus(item).type}`);
    if(canQuickEdit && !row.querySelector(".quick-stock-btn")){
      const btn=document.createElement("button");
      btn.type="button"; btn.className="secondary small quick-stock-btn"; btn.title="快速盤點"; btn.setAttribute("aria-label","快速盤點");
      btn.addEventListener("click",()=>openQuickStockModal(item.id));
      row.appendChild(btn);
    }
  });
};

createNewItem=function({name,category,safety,dept,note,shared,stock}){
  if(!name){showToast("請輸入品項名稱");return;}
  const normalized=String(name).trim().toLowerCase().replace(/\s+/g,"");
  const exists=data.items.find(item=>!item.disabled && String(item.name).trim().toLowerCase().replace(/\s+/g,"")===normalized);
  if(exists){showToast(`已存在相同品項：${exists.name}`);return;}
  const initialStock=Number(stock)||0;
  const newItem={id:`I${Date.now()}`,name,category,stock:initialStock,safety:Number(safety)||0,dept:dept||category,mode:shared?"共用型":"觀察型",note:note||"",disabled:false,createdAt:Date.now(),lastUpdatedBy:getCurrentUserLabel(),lastUpdatedEmail:getCurrentUserEmail(),lastUpdatedAt:Date.now(),lastUpdateType:"新增品項"};
  data.items.push(newItem); lastCreatedItemId=newItem.id; autoSelectNewItemInSearchFields(newItem);
  if(initialStock>0) addStockHistory(newItem,0,initialStock,"新增品項初始庫存");
  saveData(); renderAll(); showToast("新品項已新增");
};

addNewItemFromManage=function(){
  const name=document.getElementById("newItemNameManage").value.trim();
  const categoryInput=document.getElementById("newCategoryInput").value.trim();
  const categorySelect=document.getElementById("newItemCategoryManage");
  const category=categoryInput||categorySelect.value;
  const safety=Number(document.getElementById("newItemSafetyManage").value)||0;
  const stock=Number(document.getElementById("newItemStockManage")?.value||0)||0;
  const dept=document.getElementById("newItemDeptManage").value.trim()||category;
  if(categoryInput && ![...categorySelect.options].some(o=>o.value===categoryInput)){categorySelect.appendChild(new Option(categoryInput,categoryInput));categorySelect.value=categoryInput;}
  const note=document.getElementById("newItemNoteManage").value.trim();
  const shared=document.getElementById("newItemSharedManage").checked;
  createNewItem({name,category,safety,dept,note,shared,stock});
  ["newItemNameManage","newItemSafetyManage","newItemStockManage","newItemNoteManage","newCategoryInput"].forEach(id=>{const el=document.getElementById(id); if(el) el.value="";});
  document.getElementById("newItemNameManage")?.focus();
};

function renderHistoryPage(){
  const list=document.getElementById("historyPageList");
  if(!list) return;
  const search=document.getElementById("historySearchInput")?.value.trim()||historySearchKeyword||"";
  const limit=document.getElementById("historyLimitSelect")?.value||historyLimitValue||"20";
  historySearchKeyword=search; historyLimitValue=limit;
  let records=(data.history||[]).filter(record=>{
    if(!search) return true;
    return String(record.itemName||"").includes(search)||String(record.type||"").includes(search)||String(record.user||"").includes(search)||String(record.note||"").includes(search);
  });
  if(limit!=="all") records=records.slice(0,Number(limit)||20);
  if(!records.length){list.innerHTML="尚無庫存異動紀錄";return;}
  list.innerHTML=records.map(record=>{
    const changeText=(Number(record.change)||0)>0?`+${record.change}`:`${record.change||0}`;
    return `<div class="history-card">
      <div class="history-title"><span>${record.itemName||"未命名品項"}</span><span class="badge info">${record.type||"異動"}</span></div>
      <div class="history-change">${record.oldStock ?? "-"} <span class="history-arrow">→</span> ${record.newStock ?? "-"}（${changeText}）</div>
      <div class="history-meta">${record.user||"未知"}｜${record.time?formatDateTime(record.time):"-"}${record.note?`｜${record.note}`:""}</div>
    </div>`;
  }).join("");
}

function clearHistoryRecords(){
  const role=document.getElementById("roleSelect")?.value||"staff";
  if(!(role==="boss"||role==="emily")){
    showToast("只有管理員可清除異動紀錄");
    return;
  }
  if(!confirm("確定清除所有庫存異動紀錄？這不會影響目前庫存。")) return;
  data.history=[];
  saveData();
  renderAll();
  showToast("已清除庫存異動紀錄");
}

document.addEventListener("DOMContentLoaded",()=>{
  ensureV20Styles(); removeV20UnusedUI();
  document.getElementById("cancelQuickStockBtn")?.addEventListener("click",()=>closeModal("quickStockModal"));
  document.getElementById("confirmQuickStockBtn")?.addEventListener("click",confirmQuickStockUpdate);
  document.getElementById("historySearchInput")?.addEventListener("input",renderHistoryPage);
  document.getElementById("historyLimitSelect")?.addEventListener("change",renderHistoryPage);
  document.getElementById("clearHistoryBtn")?.addEventListener("click",clearHistoryRecords);
});

const gbV20RenderAll=renderAll;
renderAll=function(){
  gbV20RenderAll();
  ensureV20Styles(); removeV20UnusedUI();
  renderHistoryPage();
};

window.gbDiagnostic=function(){return {version:window.GB_VERSION,firebaseReady:!!window.GB_FIREBASE?.ready,authReady:!!window.GB_AUTH?.ready,currentRole:window.GB_AUTH?.role,currentUser:window.GB_AUTH?.user,currentTab};};


/* GoldenBird Inventory v2.0.1｜全員可盤點＋管理權限修正 */
window.GB_VERSION = "goldenbird-inventory-v2.0.1-all-staff-can-audit";

function normalizeRoleValue(role) {
  return String(role || "").trim().toLowerCase();
}

function isAdminRole(role) {
  const normalized = normalizeRoleValue(role || window.GB_AUTH?.role || document.getElementById("roleSelect")?.value);
  return ["boss", "qing", "emily"].includes(normalized);
}

function canAuditStock() {
  // 正式版：所有已登入 / 已選身份者都可以盤點，靠異動紀錄追蹤責任
  return true;
}

const gbV201RenderInventory = renderInventory;
renderInventory = function() {
  gbV201RenderInventory();

  document.querySelectorAll("#inventoryGrid .inventory-row:not(.header)").forEach(row => {
    const name = row.querySelector(".inventory-name strong")?.textContent || "";
    const item = data.items.find(i => i.name === name && !i.disabled);
    if (!item) return;

    if (typeof getStatus === "function") {
      row.classList.add(`status-${getStatus(item).type}`);
    }

    if (canAuditStock() && !row.querySelector(".quick-stock-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary small quick-stock-btn";
      btn.title = "快速盤點";
      btn.setAttribute("aria-label", "快速盤點");
      btn.addEventListener("click", () => openQuickStockModal(item.id));
      row.appendChild(btn);
    }
  });
};

// 修正管理後台權限：Emily / 老闆 / 青 可進入
const gbV201RenderAdmin = typeof renderAdmin === "function" ? renderAdmin : null;
if (gbV201RenderAdmin) {
  renderAdmin = function() {
    const adminContent = document.getElementById("adminContent");
    const adminLocked = document.getElementById("adminLocked");

    if (isAdminRole()) {
      if (adminContent) adminContent.classList.remove("hidden");
      if (adminLocked) adminLocked.classList.add("hidden");
    } else {
      if (adminContent) adminContent.classList.add("hidden");
      if (adminLocked) adminLocked.classList.remove("hidden");
    }

    gbV201RenderAdmin();
  };
}

function unlockAdminByRole() {
  const adminContent = document.getElementById("adminContent");
  const adminLocked = document.getElementById("adminLocked");

  if (isAdminRole()) {
    if (adminContent) adminContent.classList.remove("hidden");
    if (adminLocked) adminLocked.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(unlockAdminByRole, 300);
  setTimeout(unlockAdminByRole, 1000);
});

const gbV201RenderAll = renderAll;
renderAll = function() {
  gbV201RenderAll();
  unlockAdminByRole();
};

window.gbDiagnostic = function() {
  return {
    version: window.GB_VERSION,
    role: window.GB_AUTH?.role || document.getElementById("roleSelect")?.value,
    normalizedRole: normalizeRoleValue(window.GB_AUTH?.role || document.getElementById("roleSelect")?.value),
    isAdmin: isAdminRole(),
    canAuditStock: canAuditStock(),
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    currentUser: window.GB_AUTH?.user,
    currentTab
  };
};


/* GoldenBird Inventory v2.0.3｜版面微調穩定版 */
window.GB_VERSION = "goldenbird-inventory-v2.0.3-layout-polish";

function removeTemporaryAdminItemCard() {
  document.querySelectorAll("#adminContent .admin-section.card").forEach(section => {
    const text = section.textContent || "";
    if (text.includes("品項管理") && text.includes("顯示目前所有品項") && text.includes("載入中")) {
      section.remove();
    }
  });
}

function clearHistoryRecordsStable() {
  const role = String(window.GB_AUTH?.role || document.getElementById("roleSelect")?.value || "").toLowerCase();

  if (!["boss", "qing", "emily"].includes(role)) {
    showToast("只有管理員可清除異動紀錄");
    return;
  }

  const ok = window.confirm("確定要清除所有測試異動紀錄嗎？\n\n只會清除「最近庫存異動」，不會影響目前庫存、品項或在途商品。");
  if (!ok) return;

  data.history = [];
  saveData();
  renderAll();

  const historyList = document.getElementById("historyPageList");
  if (historyList) historyList.innerHTML = "尚無庫存異動紀錄";

  showToast("已清除庫存異動紀錄");
}

function refreshHistoryAfterStockChange() {
  if (typeof renderHistoryPage === "function") renderHistoryPage();
}

const gbV203ConfirmQuickStockUpdate = typeof confirmQuickStockUpdate === "function" ? confirmQuickStockUpdate : null;
if (gbV203ConfirmQuickStockUpdate) {
  confirmQuickStockUpdate = function() {
    gbV203ConfirmQuickStockUpdate();
    refreshHistoryAfterStockChange();
  };
}

document.addEventListener("DOMContentLoaded", () => {
  removeTemporaryAdminItemCard();

  const clearBtn = document.getElementById("clearHistoryBtn");
  if (clearBtn) {
    clearBtn.onclick = event => {
      event.preventDefault();
      clearHistoryRecordsStable();
    };
  }
});

const gbV203RenderAll = renderAll;
renderAll = function() {
  gbV203RenderAll();
  removeTemporaryAdminItemCard();

  const clearBtn = document.getElementById("clearHistoryBtn");
  if (clearBtn) {
    clearBtn.onclick = event => {
      event.preventDefault();
      clearHistoryRecordsStable();
    };
  }

  refreshHistoryAfterStockChange();
};

window.gbDiagnostic = function() {
  return {
    version: window.GB_VERSION,
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    role: window.GB_AUTH?.role || document.getElementById("roleSelect")?.value,
    currentTab
  };
};


/* GoldenBird Inventory v2.2 Stable｜正式整合穩定版 */
window.GB_VERSION = "goldenbird-inventory-v2.2-stable";

function gbRole() {
  return String(window.GB_AUTH?.role || document.getElementById("roleSelect")?.value || "staff").toLowerCase();
}

function gbIsAdmin() {
  return ["boss", "qing", "emily"].includes(gbRole());
}

function gbSafeRender(fn, name) {
  try {
    if (typeof fn === "function") fn();
  } catch (error) {
    console.warn(`${name} failed`, error);
  }
}

/* ---------- Firestore 同步：覆蓋舊版 startRemoteSync，避免卡在同步連線中 ---------- */
function startRemoteSync() {
  const ref = getMainDocRef();
  if (!ref) {
    updateSyncStatus("未連線", "warn");
    return;
  }

  if (gbUnsubscribeMainDoc) {
    try { gbUnsubscribeMainDoc(); } catch (error) { console.warn(error); }
  }

  updateSyncStatus("同步連線中…", "warn");

  const applyRemoteSnapshot = snapshot => {
    if (!snapshot.exists) {
      return null;
    }

    const remoteData = normalizeRemoteData(snapshot.data());
    if (!remoteData) return null;

    gbIsApplyingRemote = true;
    data = remoteData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    gbRemoteReady = true;
    gbIsApplyingRemote = false;

    updateSyncStatus("已同步", "ok");
    renderAll();
    return remoteData;
  };

  ref.get()
    .then(snapshot => {
      if (!snapshot.exists) {
        return ref.set({
          payload: data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: window.GB_AUTH?.user?.email || "unknown",
          version: window.GB_VERSION || "v2.2"
        }).then(() => {
          gbRemoteReady = true;
          updateSyncStatus("已同步", "ok");
        });
      }

      applyRemoteSnapshot(snapshot);
      return null;
    })
    .then(() => {
      gbUnsubscribeMainDoc = ref.onSnapshot(snapshot => {
        if (!snapshot.exists) return;
        applyRemoteSnapshot(snapshot);
      }, error => {
        console.error("Firestore sync error:", error);
        updateSyncStatus("同步失敗", "bad");
      });
    })
    .catch(error => {
      console.error("Firestore initial sync error:", error);
      updateSyncStatus("同步失敗", "bad");
    });
}

/* ---------- 基礎資料清理 ---------- */
function ensureDataShape() {
  data.items = Array.isArray(data.items) ? data.items : [];
  data.orders = Array.isArray(data.orders) ? data.orders : [];
  data.history = Array.isArray(data.history) ? data.history : [];
  data.mappings = Array.isArray(data.mappings) ? data.mappings : [];
}

/* ---------- 權限 ---------- */
function renderAdmin() {
  const canManage = gbIsAdmin();

  const locked = document.getElementById("adminLocked");
  const content = document.getElementById("adminContent");

  if (locked) locked.classList.toggle("hidden", canManage);
  if (content) content.classList.toggle("hidden", !canManage);

  if (!canManage) return;

  gbSafeRender(renderAdminOrders, "renderAdminOrders");
  gbSafeRender(renderCostReport, "renderCostReport");
  gbSafeRender(renderItemManageTable, "renderItemManageTable");
}

/* ---------- 品項管理：固定讀 data.items ---------- */
function refreshItemCategoryFilterOptions() {
  const select = document.getElementById("itemManageCategoryFilter");
  if (!select) return;

  const categories = [...new Set((data.items || []).map(item => item.category).filter(Boolean))].sort();
  const currentValue = itemManageCategoryValue || "all";

  select.innerHTML = `<option value="all">全部分類</option>` + categories
    .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");

  select.value = categories.includes(currentValue) ? currentValue : "all";
  itemManageCategoryValue = select.value;
}

function renderItemManageTable() {
  refreshItemCategoryFilterOptions();

  const tbody = document.getElementById("itemManageTable");
  if (!tbody) return;

  const keyword = document.getElementById("itemManageSearch")?.value.trim() || "";
  itemManageCategoryValue = document.getElementById("itemManageCategoryFilter")?.value || itemManageCategoryValue || "all";

  const rows = (data.items || [])
    .filter(item => itemManageCategoryValue === "all" || item.category === itemManageCategoryValue)
    .filter(item => !keyword || (item.name || "").includes(keyword) || (item.category || "").includes(keyword) || (item.dept || "").includes(keyword))
    .map(item => `
      <tr class="${item.id === lastCreatedItemId ? "highlight-row" : ""}">
        <td>${escapeHtml(item.name || "")}</td>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${Number(item.safety) || 0}</td>
        <td>${item.disabled ? "已停用" : "使用中"}</td>
        <td>
          <button class="secondary small edit-item-btn" data-id="${item.id}">修改</button>
          <button class="danger small toggle-item-btn" data-id="${item.id}">${item.disabled ? "啟用" : "停用"}</button>
          <button class="danger small delete-item-btn" data-id="${item.id}" style="background:#7a1f1f">刪除</button>
        </td>
      </tr>
    `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="5">找不到符合的品項</td></tr>`;

  document.querySelectorAll(".edit-item-btn").forEach(button => {
    button.onclick = () => editItem(button.dataset.id);
  });
  document.querySelectorAll(".toggle-item-btn").forEach(button => {
    button.onclick = () => toggleItemDisabled(button.dataset.id);
  });
  document.querySelectorAll(".delete-item-btn").forEach(button => {
    button.onclick = () => openDeleteItem(button.dataset.id);
  });
}

/* ---------- 新增品項：初始庫存、安全庫存，避免完全重名 ---------- */
function createNewItem({ name, category, safety, dept, note, shared, stock }) {
  if (!name) {
    showToast("請輸入品項名稱");
    return;
  }

  const normalized = String(name).trim().toLowerCase().replace(/\s+/g, "");
  const duplicated = (data.items || []).find(item => !item.disabled && String(item.name || "").trim().toLowerCase().replace(/\s+/g, "") === normalized);
  if (duplicated) {
    showToast(`已存在相同品項：${duplicated.name}`);
    return;
  }

  const initialStock = Number(stock) || 0;
  const newItem = {
    id: `I${Date.now()}`,
    name,
    category,
    stock: initialStock,
    safety: Number(safety) || 0,
    dept: dept || category,
    mode: shared ? "共用型" : "觀察型",
    note: note || "",
    disabled: false,
    createdAt: Date.now(),
    lastUpdatedBy: getCurrentUserLabel(),
    lastUpdatedEmail: getCurrentUserEmail(),
    lastUpdatedAt: Date.now(),
    lastUpdateType: "新增品項"
  };

  data.items.push(newItem);
  lastCreatedItemId = newItem.id;

  if (initialStock > 0) {
    addStockHistory(newItem, 0, initialStock, "新增品項", "初始庫存");
  }

  saveData();
  renderAll();
  showToast("新品項已新增");
}

function addNewItemFromManage() {
  const name = document.getElementById("newItemNameManage")?.value.trim() || "";
  const categoryInput = document.getElementById("newCategoryInput")?.value.trim() || "";
  const categorySelect = document.getElementById("newItemCategoryManage");
  const category = categoryInput || categorySelect?.value || "未分類";
  const safety = Number(document.getElementById("newItemSafetyManage")?.value) || 0;
  const stock = Number(document.getElementById("newItemStockManage")?.value) || 0;
  const dept = document.getElementById("newItemDeptManage")?.value.trim() || category;
  const note = document.getElementById("newItemNoteManage")?.value.trim() || "";
  const shared = document.getElementById("newItemSharedManage")?.checked || false;

  if (categoryInput && categorySelect && ![...categorySelect.options].some(option => option.value === categoryInput)) {
    categorySelect.appendChild(new Option(categoryInput, categoryInput));
    categorySelect.value = categoryInput;
  }

  createNewItem({ name, category, safety, dept, note, shared, stock });

  const keepCategory = categorySelect?.value || "";
  const keepDept = dept;
  const keepShared = shared;

  ["newItemNameManage", "newItemSafetyManage", "newItemStockManage", "newItemNoteManage", "newCategoryInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  if (categorySelect && keepCategory) categorySelect.value = keepCategory;
  const deptInput = document.getElementById("newItemDeptManage");
  if (deptInput) deptInput.value = keepDept;
  const sharedInput = document.getElementById("newItemSharedManage");
  if (sharedInput) sharedInput.checked = keepShared;

  document.getElementById("newItemNameManage")?.focus();
}

/* ---------- 在途商品：不顯示成本，確認到貨前跳確認 ---------- */
function renderIncoming() {
  const tbody = document.getElementById("incomingTable");
  if (!tbody) return;

  const activeOrders = (data.orders || []).filter(order => Number(order.qty) - Number(order.received) > 0);

  tbody.innerHTML = activeOrders.map(order => {
    const item = getItem(order.itemId);
    const remain = Math.max(0, Number(order.qty) - Number(order.received));
    const statusClass = order.status === "部分到貨" ? "warn" : "info";

    return `
      <tr class="${order.id === lastCreatedOrderId ? "highlight-row" : ""}">
        <td>${order.date || ""}</td>
        <td>${item ? escapeHtml(item.name) : escapeHtml(order.deletedItemName || "已刪除品項")}</td>
        <td>${order.qty}</td>
        <td>${order.received}</td>
        <td>${remain}</td>
        <td>${escapeHtml(order.person || "-")}</td>
        <td><span class="badge ${statusClass}">${order.status}</span></td>
        <td><input class="receive-input" data-id="${order.id}" type="number" min="1" max="${remain}" placeholder="數量" style="width:90px;"></td>
        <td><button class="small receive-btn" data-id="${order.id}">確認到貨</button></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="9">目前沒有在途商品</td></tr>`;

  document.querySelectorAll(".receive-btn").forEach(button => {
    button.onclick = () => receiveOrder(button.dataset.id);
  });
}

function renderReceiveTable() {
  /* 製程更新頁已移除，保留空函式避免舊版 renderAll 報錯 */
}

function receiveOrder(orderId) {
  const order = (data.orders || []).find(item => item.id === orderId);
  if (!order) return;

  const input = document.querySelector(`.receive-input[data-id="${orderId}"]`);
  const qty = Number(input?.value);
  const remain = Number(order.qty) - Number(order.received);
  const item = getItem(order.itemId);
  const itemName = item ? item.name : (order.deletedItemName || "品項");

  if (!qty || qty <= 0 || qty > remain) {
    showToast("請輸入正確到貨數量");
    return;
  }

  const ok = window.confirm(`確認將「${itemName}」本次到貨 ${qty} 加入庫存嗎？\n\n目前剩餘在途：${remain}\n確認後會增加庫存，並更新在途數量。`);
  if (!ok) return;

  order.received = Number(order.received) + qty;
  updateOrderStatus(order);

  if (item) {
    const oldStock = Number(item.stock) || 0;
    item.stock = oldStock + qty;
    addStockHistory(item, oldStock, item.stock, "到貨入庫", `${order.date || ""} 叫貨到貨`);
    lastUpdatedItemId = item.id;
  }

  saveData();
  renderAll();
  showToast(`${itemName} 已到貨 ${qty}，庫存已增加`);
}

/* ---------- 快速盤點：所有人可改庫存與安全庫存 ---------- */
function openQuickStockModal(itemId) {
  const item = getItem(itemId);
  if (!item) return;

  document.getElementById("quickStockItemId").value = item.id;
  document.getElementById("quickStockItemText").textContent = item.name;
  document.getElementById("quickStockOldQty").value = item.stock;
  document.getElementById("quickStockNewQty").value = item.stock;

  const safetyInput = document.getElementById("quickStockSafetyQty");
  if (safetyInput) safetyInput.value = Number(item.safety) || 0;

  const reason = document.getElementById("quickStockReason");
  if (reason) reason.value = "盤點更新";

  openModal("quickStockModal");
}

function confirmQuickStockUpdate() {
  const item = getItem(document.getElementById("quickStockItemId")?.value);
  const newQty = Number(document.getElementById("quickStockNewQty")?.value);
  const newSafety = Number(document.getElementById("quickStockSafetyQty")?.value);
  const reason = document.getElementById("quickStockReason")?.value || "盤點更新";

  if (!item || Number.isNaN(newQty) || newQty < 0) {
    showToast("請輸入正確庫存數量");
    return;
  }
  if (Number.isNaN(newSafety) || newSafety < 0) {
    showToast("請輸入正確安全庫存");
    return;
  }

  const oldStock = Number(item.stock) || 0;
  const oldSafety = Number(item.safety) || 0;

  item.stock = newQty;
  item.safety = newSafety;

  if (oldStock !== newQty || oldSafety !== newSafety) {
    const note = oldSafety !== newSafety ? `安全庫存 ${oldSafety} → ${newSafety}` : "";
    addStockHistory(item, oldStock, newQty, reason, note);
    lastUpdatedItemId = item.id;
  }

  saveData();
  closeModal("quickStockModal");
  renderAll();
  showToast(`${item.name} 已更新`);
}

/* ---------- 庫存總覽：加回快速盤點按鈕 ---------- */
const gbV22BaseRenderInventory = renderInventory;
renderInventory = function() {
  gbV22BaseRenderInventory();

  document.querySelectorAll("#inventoryGrid .inventory-row:not(.header)").forEach(row => {
    const name = row.querySelector(".inventory-name strong")?.textContent || "";
    const item = (data.items || []).find(i => i.name === name && !i.disabled);
    if (!item || row.querySelector(".quick-stock-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary small quick-stock-btn";
    btn.title = "快速盤點";
    btn.setAttribute("aria-label", "快速盤點");
    btn.textContent = "✏️";
    btn.onclick = () => openQuickStockModal(item.id);
    row.appendChild(btn);
  });

  gbMobileLastUpdaterWithTime();
};

/* ---------- 手機版：最後更新顯示人員 + 時間 ---------- */
function gbMobileLastUpdaterWithTime() {
  document.querySelectorAll("#inventoryGrid .meta-tags").forEach(meta => {
    if (meta.dataset.gbMobileUpdateApplied === "true") return;

    const last = [...meta.querySelectorAll(".meta-tag")].find(tag => (tag.textContent || "").includes("最後更新"));
    if (!last) return;

    const raw = last.textContent || "";
    const nameMatch = raw.match(/最後更新[:：]\s*([^｜]+)/);
    const timeMatch = raw.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})/);
    const updater = nameMatch ? nameMatch[1].trim() : "";
    const shortTime = timeMatch ? `${timeMatch[2]}/${timeMatch[3]} ${timeMatch[4]}` : "";

    if (updater) {
      const mobile = document.createElement("span");
      mobile.className = "meta-tag mobile-updater-only";
      mobile.textContent = shortTime ? `${updater} ${shortTime}` : updater;
      meta.appendChild(mobile);
      meta.dataset.gbMobileUpdateApplied = "true";
    }
  });
}

/* ---------- 最近異動 ---------- */
function renderHistoryPage() {
  const list = document.getElementById("historyPageList");
  if (!list) return;

  const search = document.getElementById("historySearchInput")?.value.trim() || "";
  const limit = document.getElementById("historyLimitSelect")?.value || "20";

  let records = (data.history || []).filter(record => {
    if (!search) return true;
    return String(record.itemName || "").includes(search) ||
      String(record.type || "").includes(search) ||
      String(record.user || "").includes(search) ||
      String(record.note || "").includes(search);
  });

  if (limit !== "all") records = records.slice(0, Number(limit) || 20);

  if (!records.length) {
    list.innerHTML = "尚無庫存異動紀錄";
    return;
  }

  list.innerHTML = records.map(record => {
    const changeText = Number(record.change) > 0 ? `+${record.change}` : `${record.change || 0}`;
    return `
      <div class="history-row">
        <div><strong>${escapeHtml(record.itemName || "未命名品項")}</strong> <span class="meta-tag mode">${escapeHtml(record.type || "異動")}</span></div>
        <div>${record.oldStock ?? "-"} → ${record.newStock ?? "-"}（${changeText}）</div>
        <div class="history-meta">${escapeHtml(record.user || "未知")}｜${formatDateTime(record.time)}${record.note ? `｜${escapeHtml(record.note)}` : ""}</div>
      </div>
    `;
  }).join("");
}

function clearHistoryRecords() {
  if (!gbIsAdmin()) {
    showToast("只有管理員可清除異動紀錄");
    return;
  }

  const ok = window.confirm("確定要清除所有測試異動紀錄嗎？\n\n此操作只會清除「最近庫存異動」，不會影響庫存、品項或在途商品。");
  if (!ok) return;

  data.history = [];
  saveData();
  renderAll();
  showToast("已清除庫存異動紀錄");
}

/* ---------- 手機版 header 收合 ---------- */
function gbApplyStableStyles() {
  if (document.getElementById("gbV22Styles")) return;

  const style = document.createElement("style");
  style.id = "gbV22Styles";
  style.textContent = `
    .mobile-account-toggle { display: none; }

    #inventoryGrid .quick-stock-btn {
      margin-top: 8px;
      min-width: 34px;
      width: 34px;
      height: 30px;
      padding: 0 !important;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }

    @media(max-width:760px){
      .mobile-account-toggle {
        display: inline-flex !important;
        align-self: flex-end;
        margin-top: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
      }

      .role-box {
        display: none !important;
        margin-top: 8px;
        padding: 10px;
        border-radius: 16px;
        background: rgba(255,255,255,.72);
        border: 1px solid var(--line);
      }

      .role-box.mobile-open { display: flex !important; }

      #inventoryGrid .meta-tags .meta-tag:not(.mobile-updater-only){
        display:none !important;
      }

      #inventoryGrid .meta-tags .mobile-updater-only{
        display:inline-flex !important;
      }
    }

    @media(min-width:761px){
      #inventoryGrid .meta-tags .mobile-updater-only{
        display:none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function gbBindStableEvents() {
  const quickConfirm = document.getElementById("confirmQuickStockBtn");
  if (quickConfirm) quickConfirm.onclick = confirmQuickStockUpdate;

  const quickCancel = document.getElementById("cancelQuickStockBtn");
  if (quickCancel) quickCancel.onclick = () => closeModal("quickStockModal");

  const clearBtn = document.getElementById("clearHistoryBtn");
  if (clearBtn) clearBtn.onclick = event => {
    event.preventDefault();
    clearHistoryRecords();
  };

  const itemSearch = document.getElementById("itemManageSearch");
  if (itemSearch) itemSearch.oninput = renderItemManageTable;

  const itemCategory = document.getElementById("itemManageCategoryFilter");
  if (itemCategory) itemCategory.onchange = event => {
    itemManageCategoryValue = event.target.value;
    renderItemManageTable();
  };

  const mobileBtn = document.getElementById("mobileAccountToggleBtn");
  const roleBox = document.getElementById("roleBox") || document.querySelector(".role-box");
  if (mobileBtn && roleBox && mobileBtn.dataset.bound !== "true") {
    mobileBtn.onclick = () => {
      roleBox.classList.toggle("mobile-open");
      mobileBtn.textContent = roleBox.classList.contains("mobile-open") ? "收起帳號資訊 ▴" : "帳號 / 同步 ▾";
    };
    mobileBtn.dataset.bound = "true";
  }
}

/* ---------- 統一 renderAll，避免舊版不存在的區塊報錯 ---------- */
renderAll = function() {
  ensureDataShape();
  gbSafeRender(ensureRoleOptions, "ensureRoleOptions");
  gbSafeRender(ensureStockHistoryUI, "ensureStockHistoryUI");
  gbSafeRender(renderInventory, "renderInventory");
  gbSafeRender(renderIncoming, "renderIncoming");
  gbSafeRender(renderAdmin, "renderAdmin");
  gbSafeRender(setManualOrderDefaultDate, "setManualOrderDefaultDate");
  gbSafeRender(renderStockHistory, "renderStockHistory");
  gbSafeRender(renderHistoryPage, "renderHistoryPage");
  gbSafeRender(ensureExcelExportButton, "ensureExcelExportButton");
  gbApplyStableStyles();
  gbBindStableEvents();
};

document.addEventListener("DOMContentLoaded", () => {
  gbApplyStableStyles();
  gbBindStableEvents();
  renderAll();
});

window.gbDiagnostic = function() {
  return {
    version: window.GB_VERSION,
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    hasUser: !!window.GB_AUTH?.user,
    user: window.GB_AUTH?.user,
    role: window.GB_AUTH?.role || document.getElementById("roleSelect")?.value,
    isAdmin: gbIsAdmin(),
    syncText: document.getElementById("syncStatusText")?.textContent,
    hasFirestoreDb: !!window.GB_FIREBASE?.db,
    hasStartRemoteSync: typeof startRemoteSync === "function",
    itemCount: data.items?.length || 0,
    orderCount: data.orders?.length || 0,
    historyCount: data.history?.length || 0,
    currentTab
  };
};


/* GoldenBird Inventory v2.2.1｜品項管理清單修正 */
window.GB_VERSION = "goldenbird-inventory-v2.2.1-item-list-fix";

function gbEsc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function gbGetAllItemsForManage() {
  if (!window.data && typeof data === "undefined") return [];
  return Array.isArray(data.items) ? data.items : [];
}

function renderItemManageTable() {
  const tbody = document.getElementById("itemManageTable");
  if (!tbody) return;

  const select = document.getElementById("itemManageCategoryFilter");
  const searchInput = document.getElementById("itemManageSearch");
  const keyword = searchInput ? searchInput.value.trim() : "";

  const allItems = gbGetAllItemsForManage();

  const categories = [...new Set(allItems.map(item => item.category).filter(Boolean))].sort();
  const currentValue = select ? (select.value || itemManageCategoryValue || "all") : (itemManageCategoryValue || "all");

  if (select) {
    select.innerHTML = `<option value="all">全部分類</option>` + categories
      .map(category => `<option value="${gbEsc(category)}">${gbEsc(category)}</option>`)
      .join("");

    select.value = categories.includes(currentValue) ? currentValue : "all";
    itemManageCategoryValue = select.value;
  }

  const rows = allItems
    .filter(item => itemManageCategoryValue === "all" || item.category === itemManageCategoryValue)
    .filter(item => {
      if (!keyword) return true;
      return String(item.name || "").includes(keyword) ||
        String(item.category || "").includes(keyword) ||
        String(item.dept || "").includes(keyword);
    })
    .map(item => `
      <tr class="${item.id === lastCreatedItemId ? "highlight-row" : ""}">
        <td>${gbEsc(item.name || "")}</td>
        <td>${gbEsc(item.category || "")}</td>
        <td>${Number(item.safety) || 0}</td>
        <td>${item.disabled ? "已停用" : "使用中"}</td>
        <td>
          <button class="secondary small edit-item-btn" data-id="${gbEsc(item.id)}">修改</button>
          <button class="danger small toggle-item-btn" data-id="${gbEsc(item.id)}">${item.disabled ? "啟用" : "停用"}</button>
          <button class="danger small delete-item-btn" data-id="${gbEsc(item.id)}" style="background:#7a1f1f">刪除</button>
        </td>
      </tr>
    `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="5">目前沒有符合的品項</td></tr>`;

  document.querySelectorAll(".edit-item-btn").forEach(button => {
    button.onclick = () => editItem(button.dataset.id);
  });

  document.querySelectorAll(".toggle-item-btn").forEach(button => {
    button.onclick = () => toggleItemDisabled(button.dataset.id);
  });

  document.querySelectorAll(".delete-item-btn").forEach(button => {
    button.onclick = () => openDeleteItem(button.dataset.id);
  });
}

function gbRefreshItemManageWhenAdminVisible() {
  if (currentTab === "admin" || !document.getElementById("adminContent")?.classList.contains("hidden")) {
    renderItemManageTable();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(gbRefreshItemManageWhenAdminVisible, 300);
  setTimeout(gbRefreshItemManageWhenAdminVisible, 1000);
  setTimeout(gbRefreshItemManageWhenAdminVisible, 2000);

  const search = document.getElementById("itemManageSearch");
  if (search) search.oninput = renderItemManageTable;

  const category = document.getElementById("itemManageCategoryFilter");
  if (category) category.onchange = event => {
    itemManageCategoryValue = event.target.value;
    renderItemManageTable();
  };

  const reset = document.getElementById("resetItemManageFilterBtn");
  if (reset) reset.onclick = event => {
    event.preventDefault();
    itemManageCategoryValue = "all";
    if (search) search.value = "";
    renderItemManageTable();
  };
});

const gbV221SwitchTab = switchTab;
switchTab = function(tab) {
  gbV221SwitchTab(tab);
  if (tab === "admin") setTimeout(renderItemManageTable, 100);
};

const gbV221RenderAll = renderAll;
renderAll = function() {
  gbV221RenderAll();
  gbRefreshItemManageWhenAdminVisible();
};

window.gbDiagnostic = function() {
  return {
    version: window.GB_VERSION,
    syncText: document.getElementById("syncStatusText")?.textContent,
    firebaseReady: !!window.GB_FIREBASE?.ready,
    authReady: !!window.GB_AUTH?.ready,
    role: window.GB_AUTH?.role || document.getElementById("roleSelect")?.value,
    currentTab,
    itemCount: Array.isArray(data.items) ? data.items.length : 0,
    itemManageRows: document.querySelectorAll("#itemManageTable tr").length,
    itemManageTableFound: !!document.getElementById("itemManageTable")
  };
};


/* GoldenBird Inventory v2.2.2｜手機版固定頁籤與更新時間顯示 */
window.GB_VERSION = "goldenbird-inventory-v2.2.2-mobile-tabs-update-time";

function gbApplyMobileTabAndUpdateTimeFix() {
  if (document.getElementById("gbV222MobileStyles")) return;

  const style = document.createElement("style");
  style.id = "gbV222MobileStyles";
  style.textContent = `
    @media (max-width: 760px) {
      /* 手機下滑時，固定常用的「庫存總覽 / 在途商品」 */
      main .tabs {
        position: sticky;
        top: 0;
        z-index: 80;
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
        padding: 8px 12px !important;
        background: rgba(248, 247, 243, .96);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
      }

      main .tabs .tab {
        min-width: 0 !important;
        width: 100% !important;
        padding: 10px 8px !important;
        font-size: 15px !important;
        white-space: nowrap;
      }

      /* 手機固定區只顯示最常用兩個，最近異動/後台仍可從頁面上方進入 */
      main .tabs .tab[data-tab="history"],
      main .tabs .tab[data-tab="admin"] {
        display: none !important;
      }

      /* 小卡片更新標籤完整顯示：更新人員 + 時間 */
      #inventoryGrid .meta-tags {
        overflow: visible !important;
        white-space: normal !important;
        line-height: 1.45 !important;
      }

      #inventoryGrid .meta-tags .mobile-updater-only {
        max-width: none !important;
        width: auto !important;
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
        padding: 3px 8px !important;
        font-size: 11.5px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function gbBuildMobileUpdaterLabelV222() {
  document.querySelectorAll("#inventoryGrid .meta-tags").forEach(meta => {
    const oldMobile = meta.querySelector(".mobile-updater-only");
    if (oldMobile) oldMobile.remove();

    const last = [...meta.querySelectorAll(".meta-tag")].find(tag => (tag.textContent || "").includes("最後更新"));
    if (!last) return;

    const raw = last.textContent || "";
    const nameMatch = raw.match(/最後更新[:：]\s*([^｜]+)/);
    const timeMatch = raw.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})/);

    const updater = nameMatch ? nameMatch[1].trim() : "";
    const shortTime = timeMatch ? `${timeMatch[2]}/${timeMatch[3]} ${timeMatch[4]}` : "";

    if (!updater) return;

    const mobile = document.createElement("span");
    mobile.className = "meta-tag mobile-updater-only";
    mobile.textContent = shortTime ? `${updater} ${shortTime}` : updater;
    meta.appendChild(mobile);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  gbApplyMobileTabAndUpdateTimeFix();
  setTimeout(gbBuildMobileUpdaterLabelV222, 300);
  setTimeout(gbBuildMobileUpdaterLabelV222, 1000);
});

const gbV222RenderAll = renderAll;
renderAll = function() {
  gbV222RenderAll();
  gbApplyMobileTabAndUpdateTimeFix();
  gbBuildMobileUpdaterLabelV222();
};

/* GoldenBird Inventory v2.2.3｜叫貨表單 UI 修正 */
(function(){
  function applyOrderFormFix(){
    if(document.getElementById("gbV223OrderCss")) return;
    const s=document.createElement("style");
    s.id="gbV223OrderCss";
    s.textContent=`
    .order-form input[type="date"],
    input[type="date"]{
      width:100%;
      min-width:0 !important;
      box-sizing:border-box;
    }
    @media (max-width:760px){
      .order-form,
      .manual-order-grid{
        display:grid;
        grid-template-columns:1fr !important;
        gap:12px;
      }
      .order-form button,
      .manual-order-grid button{
        width:100%;
      }
    }`;
    document.head.appendChild(s);
  }
  document.addEventListener("DOMContentLoaded",applyOrderFormFix);
  const _r=renderAll;
  renderAll=function(){_r();applyOrderFormFix();}
})();

/* GoldenBird Inventory v2.2.4｜最近異動 UI 微調 */
(function(){
  function applyHistoryUiPolish(){
    if(document.getElementById("gbV224HistoryCss")) return;
    const style=document.createElement("style");
    style.id="gbV224HistoryCss";
    style.textContent=`
      #clearHistoryBtn{
        background:#f8fbfb !important;
        color:var(--text) !important;
        border:1px solid var(--line) !important;
        box-shadow:none !important;
      }
      #clearHistoryBtn:hover{
        background:#eef5f6 !important;
      }
      #historyRecordSummary{
        margin:10px 0 0;
        color:var(--muted);
        font-weight:700;
        font-size:14px;
      }
      #history .form-grid{
        align-items:end;
      }
      #history .field input,
      #history .field select,
      #history .field button{
        min-height:44px;
        box-sizing:border-box;
      }
      @media(max-width:760px){
        #history .form-grid{
          grid-template-columns:1fr !important;
          gap:12px;
        }
        #clearHistoryBtn{
          width:100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function updateHistorySummary(){
    const card=document.querySelector("#history .card");
    if(!card) return;

    let summary=document.getElementById("historyRecordSummary");
    if(!summary){
      summary=document.createElement("p");
      summary.id="historyRecordSummary";
      const note=card.querySelector(".note");
      if(note) note.insertAdjacentElement("beforebegin", summary);
      else card.appendChild(summary);
    }

    const total=Array.isArray(data.history)?data.history.length:0;
    const limit=document.getElementById("historyLimitSelect")?.value || "20";
    const displayText=limit==="all" ? "全部" : `最近 ${limit} 筆`;
    summary.textContent=`目前共有 ${total} 筆異動紀錄，顯示：${displayText}`;
  }

  function normalizeHistoryClearButton(){
    const btn=document.getElementById("clearHistoryBtn");
    if(btn){
      btn.textContent="清除異動紀錄";
      btn.classList.remove("danger");
      btn.classList.add("secondary");
    }
  }

  const oldClearHistory=typeof clearHistoryRecords==="function" ? clearHistoryRecords : null;
  if(oldClearHistory){
    clearHistoryRecords=function(){
      const ok=window.confirm("確定清除所有庫存異動紀錄？\n\n✓ 不會影響目前庫存\n✓ 不會影響在途商品\n✓ 不會影響品項資料\n\n此動作無法復原。");
      if(!ok) return;

      const originalConfirm=window.confirm;
      window.confirm=()=>true;
      try{
        oldClearHistory();
      }finally{
        window.confirm=originalConfirm;
      }
      updateHistorySummary();
    };
  }

  document.addEventListener("DOMContentLoaded",()=>{
    applyHistoryUiPolish();
    normalizeHistoryClearButton();
    setTimeout(updateHistorySummary,300);
  });

  const oldRenderAll=renderAll;
  renderAll=function(){
    oldRenderAll();
    applyHistoryUiPolish();
    normalizeHistoryClearButton();
    updateHistorySummary();
  };
})();

/* GoldenBird Inventory v2.2.5｜手機版頁籤凍結修正 */
(function(){
  function applyMobileStickyFix(){
    if(document.getElementById("gbV225MobileStickyCss")) return;
    const style=document.createElement("style");
    style.id="gbV225MobileStickyCss";
    style.textContent=`
      @media(max-width:760px){
        /* header 不固定，避免大標題與帳號區下滑時往下擠 */
        header,
        header .header-inner{
          position:relative !important;
          top:auto !important;
          z-index:auto !important;
        }

        /* 未下滑前：四個主標籤正常顯示 */
        main .tabs{
          position:relative !important;
          top:auto !important;
          z-index:20 !important;
          display:grid !important;
          grid-template-columns:1fr 1fr !important;
          gap:8px !important;
          padding:8px 12px !important;
          background:transparent !important;
          border-bottom:0 !important;
          backdrop-filter:none !important;
        }

        main .tabs .tab{
          display:flex !important;
          align-items:center !important;
          justify-content:center !important;
          width:100% !important;
          min-width:0 !important;
          white-space:nowrap !important;
          padding:10px 8px !important;
          font-size:15px !important;
        }

        main .tabs .tab[data-tab="history"],
        main .tabs .tab[data-tab="admin"]{
          display:flex !important;
        }

        /* 下滑後：只固定庫存總覽 / 在途商品 */
        body.gb-mobile-scrolled main .tabs{
          position:sticky !important;
          top:0 !important;
          z-index:100 !important;
          background:rgba(248,247,243,.96) !important;
          backdrop-filter:blur(8px) !important;
          border-bottom:1px solid var(--line) !important;
          box-shadow:0 6px 16px rgba(0,0,0,.05);
        }

        body.gb-mobile-scrolled main .tabs .tab[data-tab="history"],
        body.gb-mobile-scrolled main .tabs .tab[data-tab="admin"]{
          display:none !important;
        }

        body.gb-mobile-scrolled main .tabs .tab[data-tab="overview"],
        body.gb-mobile-scrolled main .tabs .tab[data-tab="incoming"]{
          display:flex !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function updateMobileScrollState(){
    if(window.innerWidth > 760){
      document.body.classList.remove("gb-mobile-scrolled");
      return;
    }
    document.body.classList.toggle("gb-mobile-scrolled", window.scrollY > 120);
  }

  function bindMobileStickyFix(){
    if(window.__gbMobileStickyFixBound) return;
    window.__gbMobileStickyFixBound=true;
    window.addEventListener("scroll", updateMobileScrollState, {passive:true});
    window.addEventListener("resize", updateMobileScrollState);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    applyMobileStickyFix();
    bindMobileStickyFix();
    updateMobileScrollState();
  });

  const oldRenderAll=renderAll;
  renderAll=function(){
    oldRenderAll();
    applyMobileStickyFix();
    bindMobileStickyFix();
    updateMobileScrollState();
  };
})();

/* GoldenBird Inventory v2.2.6｜品項新增/刪除按鈕事件修正 */
(function(){
  function bindItemManagementButtons(){
    const addBtn = document.getElementById("addItemManageBtn");
    if(addBtn){
      addBtn.onclick = function(event){
        event.preventDefault();
        if(typeof addNewItemFromManage === "function"){
          addNewItemFromManage();
        }
      };
    }

    const confirmDeleteBtn = document.getElementById("confirmDeleteItemBtn");
    if(confirmDeleteBtn){
      confirmDeleteBtn.onclick = function(event){
        event.preventDefault();
        if(typeof confirmDeleteItem === "function"){
          confirmDeleteItem();
        }
      };
    }

    const cancelDeleteBtn = document.getElementById("cancelDeleteItemBtn");
    if(cancelDeleteBtn){
      cancelDeleteBtn.onclick = function(event){
        event.preventDefault();
        if(typeof closeModal === "function"){
          closeModal("deleteItemModal");
        }
      };
    }

    document.querySelectorAll(".edit-item-btn").forEach(btn=>{
      btn.onclick = () => editItem(btn.dataset.id);
    });
    document.querySelectorAll(".toggle-item-btn").forEach(btn=>{
      btn.onclick = () => toggleItemDisabled(btn.dataset.id);
    });
    document.querySelectorAll(".delete-item-btn").forEach(btn=>{
      btn.onclick = () => openDeleteItem(btn.dataset.id);
    });
  }

  document.addEventListener("DOMContentLoaded",()=>{
    bindItemManagementButtons();
    setTimeout(bindItemManagementButtons,300);
    setTimeout(bindItemManagementButtons,1000);
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    bindItemManagementButtons();
  };

  window.gbBindItemManagementButtons = bindItemManagementButtons;
})();

/* GoldenBird Inventory v2.2.7｜浮動回頂端 / 回庫存總覽按鈕 */
(function(){
  function ensureFloatingButtons(){
    if(document.getElementById("gbFloatActions")) return;

    const wrap = document.createElement("div");
    wrap.id = "gbFloatActions";
    wrap.innerHTML = `
      <button id="gbHomeBtn" type="button" title="回庫存總覽">🏠</button>
      <button id="gbTopBtn" type="button" title="回到最上方">▲</button>
    `;
    document.body.appendChild(wrap);

    const style = document.createElement("style");
    style.id = "gbFloatActionsCss";
    style.textContent = `
      #gbFloatActions{
        position:fixed;
        right:18px;
        bottom:22px;
        z-index:120;
        display:flex;
        flex-direction:column;
        gap:8px;
        opacity:0;
        pointer-events:none;
        transform:translateY(8px);
        transition:opacity .2s ease, transform .2s ease;
      }
      #gbFloatActions.show{
        opacity:1;
        pointer-events:auto;
        transform:translateY(0);
      }
      #gbFloatActions button{
        width:44px;
        height:44px;
        border-radius:999px;
        border:1px solid var(--line);
        background:rgba(255,255,255,.92);
        color:var(--text);
        box-shadow:0 8px 20px rgba(0,0,0,.12);
        font-weight:800;
        font-size:16px;
        cursor:pointer;
      }
      #gbFloatActions button:active{
        transform:scale(.96);
      }
      @media(max-width:760px){
        #gbFloatActions{
          right:14px;
          bottom:18px;
        }
        #gbFloatActions button{
          width:42px;
          height:42px;
          font-size:15px;
        }
      }
    `;
    document.head.appendChild(style);

    document.getElementById("gbTopBtn").onclick = function(){
      window.scrollTo({top:0, behavior:"smooth"});
    };

    document.getElementById("gbHomeBtn").onclick = function(){
      if(typeof switchTab === "function") switchTab("overview");
      setTimeout(()=>window.scrollTo({top:0, behavior:"smooth"}), 50);
    };
  }

  function updateFloatingButtons(){
    const wrap = document.getElementById("gbFloatActions");
    if(!wrap) return;
    wrap.classList.toggle("show", window.scrollY > 420);
  }

  function bindFloatingButtons(){
    if(window.__gbFloatButtonsBound) return;
    window.__gbFloatButtonsBound = true;
    window.addEventListener("scroll", updateFloatingButtons, {passive:true});
    window.addEventListener("resize", updateFloatingButtons);
  }

  document.addEventListener("DOMContentLoaded", function(){
    ensureFloatingButtons();
    bindFloatingButtons();
    updateFloatingButtons();
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    ensureFloatingButtons();
    bindFloatingButtons();
    updateFloatingButtons();
  };
})();

/* GoldenBird Inventory v2.2.8｜分類同步修正 */
(function(){
  function normalizeCategory(v){
    return String(v||"").trim();
  }

  function refreshAllCategorySelectors(){
    if(typeof data==="undefined" || !Array.isArray(data.items)) return;
    const cats=[...new Set(data.items.map(i=>normalizeCategory(i.category)).filter(Boolean))].sort();

    [
      "inventoryCategoryFilter",
      "itemManageCategoryFilter",
      "newItemCategoryManage"
    ].forEach(id=>{
      const sel=document.getElementById(id);
      if(!sel) return;

      const current=sel.value;

      if(id==="newItemCategoryManage"){
        sel.innerHTML=cats.map(c=>`<option value="${c}">${c}</option>`).join("");
      }else{
        sel.innerHTML='<option value="all">全部分類</option>'+
          cats.map(c=>`<option value="${c}">${c}</option>`).join("");
      }

      if([...sel.options].some(o=>o.value===current)){
        sel.value=current;
      }
    });
  }

  const oldCreate=createNewItem;
  createNewItem=function(args){
    if(args && args.category){
      const n=normalizeCategory(args.category);
      const exist=[...new Set((data.items||[]).map(i=>normalizeCategory(i.category)))].find(c=>c.toLowerCase()===n.toLowerCase());
      if(exist) args.category=exist;
    }
    oldCreate(args);
    refreshAllCategorySelectors();
  }

  const oldRenderAllV228=renderAll;
  renderAll=function(){
    oldRenderAllV228();
    refreshAllCategorySelectors();
  }

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(refreshAllCategorySelectors,300);
  });
})();

/* GoldenBird Inventory v2.2.9｜庫存總覽分類篩選同步修正 */
(function(){
  function gbNormalizeCategory(value){
    return String(value || "").trim();
  }

  function gbGetCategories(){
    if(typeof data === "undefined" || !Array.isArray(data.items)) return [];
    return [...new Set(data.items.map(item => gbNormalizeCategory(item.category)).filter(Boolean))].sort();
  }

  function gbRefreshCategorySelect(selectId, includeAll){
    const select = document.getElementById(selectId);
    if(!select) return;

    const categories = gbGetCategories();
    const current = select.value;

    select.innerHTML =
      (includeAll ? '<option value="all">全部分類</option>' : '') +
      categories.map(category => `<option value="${category}">${category}</option>`).join("");

    if([...select.options].some(option => option.value === current)){
      select.value = current;
    }else if(includeAll){
      select.value = "all";
    }
  }

  function gbRefreshAllCategoryFilters(){
    // 庫存總覽分類篩選器的正確 ID 是 categoryFilter
    gbRefreshCategorySelect("categoryFilter", true);

    // 品項管理分類篩選
    gbRefreshCategorySelect("itemManageCategoryFilter", true);

    // 新增品項分類下拉
    gbRefreshCategorySelect("newItemCategoryManage", false);
  }

  function gbUseExistingCategoryName(inputCategory){
    const raw = gbNormalizeCategory(inputCategory);
    if(!raw) return raw;

    const existing = gbGetCategories().find(category =>
      category.toLowerCase() === raw.toLowerCase()
    );

    return existing || raw;
  }

  const oldAddNewItemFromManage = typeof addNewItemFromManage === "function" ? addNewItemFromManage : null;
  if(oldAddNewItemFromManage){
    addNewItemFromManage = function(){
      const categoryInput = document.getElementById("newCategoryInput");
      const categorySelect = document.getElementById("newItemCategoryManage");

      // 若有輸入「新增分類」，先整理成既有分類或新分類
      if(categoryInput && categoryInput.value.trim()){
        categoryInput.value = gbUseExistingCategoryName(categoryInput.value);
      }else if(categorySelect && categorySelect.value){
        categorySelect.value = gbUseExistingCategoryName(categorySelect.value);
      }

      oldAddNewItemFromManage();
      gbRefreshAllCategoryFilters();

      // 新增後讓庫存總覽分類預設保持全部，避免剛新增後被舊分類篩掉
      const overviewFilter = document.getElementById("categoryFilter");
      if(overviewFilter && ![...overviewFilter.options].some(option => option.value === overviewFilter.value)){
        overviewFilter.value = "all";
      }
    };
  }

  const oldCreateNewItem = typeof createNewItem === "function" ? createNewItem : null;
  if(oldCreateNewItem){
    createNewItem = function(args){
      if(args && args.category){
        args.category = gbUseExistingCategoryName(args.category);
      }
      oldCreateNewItem(args);
      gbRefreshAllCategoryFilters();
    };
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    setTimeout(gbRefreshAllCategoryFilters, 300);
    setTimeout(gbRefreshAllCategoryFilters, 1000);
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    gbRefreshAllCategoryFilters();
  };

  window.gbRefreshAllCategoryFilters = gbRefreshAllCategoryFilters;
})();

/* GoldenBird Inventory v2.2.10｜手動叫貨品項自動選取 */
(function(){
  function getOrderSearchInput(){
    return document.getElementById("manualOrderItemSearch")
      || document.getElementById("orderItemSearch")
      || document.getElementById("newOrderItemSearch")
      || document.querySelector('input[placeholder*="內部品項"]');
  }

  function getOrderItemHiddenInput(){
    return document.getElementById("manualOrderItemId")
      || document.getElementById("orderItemId")
      || document.getElementById("newOrderItemId");
  }

  function normalizeText(text){
    return String(text || "").toLowerCase().replace(/\s+/g,"");
  }

  function ensureOrderSuggestBox(){
    const input = getOrderSearchInput();
    if(!input) return null;

    let box = document.getElementById("orderItemSuggestBox");
    if(box) return box;

    box = document.createElement("div");
    box.id = "orderItemSuggestBox";
    box.className = "order-suggest-box hidden";
    input.insertAdjacentElement("afterend", box);

    if(!document.getElementById("orderSuggestCss")){
      const style = document.createElement("style");
      style.id = "orderSuggestCss";
      style.textContent = `
        .order-suggest-box{
          margin-top:6px;
          border:1px solid var(--line);
          border-radius:14px;
          background:#fff;
          box-shadow:0 10px 26px rgba(0,0,0,.08);
          max-height:240px;
          overflow:auto;
          position:relative;
          z-index:30;
        }
        .order-suggest-box.hidden{display:none;}
        .order-suggest-item{
          width:100%;
          border:0;
          background:#fff;
          color:var(--text);
          text-align:left;
          padding:10px 12px;
          border-bottom:1px solid #edf1f1;
          cursor:pointer;
          font-weight:700;
        }
        .order-suggest-item:last-child{border-bottom:0;}
        .order-suggest-item:hover{background:#f7fbfb;}
        .order-suggest-meta{
          display:block;
          margin-top:3px;
          color:var(--muted);
          font-size:12px;
          font-weight:700;
        }
      `;
      document.head.appendChild(style);
    }

    return box;
  }

  function renderOrderSuggestions(){
    const input = getOrderSearchInput();
    const box = ensureOrderSuggestBox();
    if(!input || !box || typeof data === "undefined" || !Array.isArray(data.items)) return;

    const keyword = normalizeText(input.value);
    if(!keyword){
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }

    const matches = data.items
      .filter(item => !item.disabled)
      .filter(item => {
        const hay = normalizeText(`${item.name} ${item.category} ${item.dept || ""}`);
        return hay.includes(keyword);
      })
      .slice(0, 8);

    if(!matches.length){
      box.innerHTML = `<div class="order-suggest-item" style="cursor:default;color:var(--muted)">找不到相關品項</div>`;
      box.classList.remove("hidden");
      return;
    }

    box.innerHTML = matches.map(item => `
      <button type="button" class="order-suggest-item" data-id="${item.id}">
        ${item.name}
        <span class="order-suggest-meta">${item.category || "未分類"}｜庫存 ${Number(item.stock)||0}｜安全 ${Number(item.safety)||0}</span>
      </button>
    `).join("");

    box.classList.remove("hidden");

    box.querySelectorAll(".order-suggest-item[data-id]").forEach(btn=>{
      btn.onclick = () => selectOrderItem(btn.dataset.id);
    });
  }

  function selectOrderItem(itemId){
    const item = data.items.find(i => i.id === itemId);
    const input = getOrderSearchInput();
    const hidden = getOrderItemHiddenInput();

    if(!item || !input) return;

    input.value = item.name;
    input.dataset.selectedItemId = item.id;
    input.dataset.selectedItemName = item.name;

    if(hidden) hidden.value = item.id;

    const box = ensureOrderSuggestBox();
    if(box){
      box.classList.add("hidden");
      box.innerHTML = "";
    }

    if(typeof showToast === "function") showToast(`已選取：${item.name}`);
  }

  function bindOrderAutocomplete(){
    const input = getOrderSearchInput();
    if(!input || input.dataset.autocompleteBound === "true") return;

    input.setAttribute("autocomplete","off");

    input.addEventListener("input",()=>{
      input.dataset.selectedItemId = "";
      renderOrderSuggestions();
    });

    input.addEventListener("focus",renderOrderSuggestions);

    input.addEventListener("blur",()=>{
      setTimeout(()=>{
        const box = document.getElementById("orderItemSuggestBox");
        if(box) box.classList.add("hidden");
      },180);
    });

    input.dataset.autocompleteBound = "true";
  }

  function resolveManualOrderItemFromSearch(){
    const input = getOrderSearchInput();
    if(!input) return null;

    const selectedId = input.dataset.selectedItemId;
    if(selectedId){
      const selected = data.items.find(i => i.id === selectedId && !i.disabled);
      if(selected) return selected;
    }

    const keyword = normalizeText(input.value);
    if(!keyword) return null;

    const exact = data.items.find(item => !item.disabled && normalizeText(item.name) === keyword);
    if(exact) return exact;

    const partial = data.items.filter(item => !item.disabled && normalizeText(item.name).includes(keyword));
    if(partial.length === 1) return partial[0];

    if(partial.length > 1){
      renderOrderSuggestions();
      if(typeof showToast === "function") showToast("找到多個品項，請先從下方選取");
      return null;
    }

    return null;
  }

  const oldAddManualOrder = typeof addManualOrder === "function" ? addManualOrder : null;
  if(oldAddManualOrder){
    addManualOrder = function(){
      const input = getOrderSearchInput();
      const hidden = getOrderItemHiddenInput();
      const item = resolveManualOrderItemFromSearch();

      if(input && item){
        input.value = item.name;
        input.dataset.selectedItemId = item.id;
        if(hidden) hidden.value = item.id;
      }

      oldAddManualOrder();
    };
  }

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(bindOrderAutocomplete,300);
    setTimeout(bindOrderAutocomplete,1000);
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    bindOrderAutocomplete();
  };

  window.gbBindOrderAutocomplete = bindOrderAutocomplete;
})();

/* GoldenBird Inventory v2.2.11｜管理後台分頁整理 */
(function(){
  function ensureAdminTabs(){
    const adminContent = document.getElementById("adminContent");
    if(!adminContent || document.getElementById("adminSubTabs")) return;

    const tabs = document.createElement("div");
    tabs.id = "adminSubTabs";
    tabs.className = "admin-sub-tabs";
    tabs.innerHTML = `
      <button type="button" class="admin-sub-tab active" data-admin-tab="items">📦 品項管理</button>
      <button type="button" class="admin-sub-tab" data-admin-tab="orders">🚚 叫貨管理</button>
      <button type="button" class="admin-sub-tab" data-admin-tab="costs">💰 成本報表</button>
    `;

    adminContent.insertAdjacentElement("afterbegin", tabs);

    const sections = [...adminContent.children].filter(el => el !== tabs);
    sections.forEach(section => {
      const text = (section.textContent || "").trim();

      if(text.includes("品項管理") || text.includes("新增品項") || text.includes("不想再列入庫存的品項")) {
        section.dataset.adminGroup = "items";
      } else if(text.includes("叫貨管理") || text.includes("手動新增叫貨") || text.includes("叫貨紀錄") || text.includes("在途")) {
        section.dataset.adminGroup = "orders";
      } else if(text.includes("資料匯出") || text.includes("成本") || text.includes("Excel") || text.includes("報表")) {
        section.dataset.adminGroup = "costs";
      } else {
        section.dataset.adminGroup = "items";
      }
    });

    tabs.querySelectorAll(".admin-sub-tab").forEach(btn => {
      btn.onclick = () => switchAdminSubTab(btn.dataset.adminTab);
    });

    switchAdminSubTab(localStorage.getItem("gbAdminSubTab") || "items");
  }

  function switchAdminSubTab(tab){
    const tabs = document.getElementById("adminSubTabs");
    const adminContent = document.getElementById("adminContent");
    if(!tabs || !adminContent) return;

    tabs.querySelectorAll(".admin-sub-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.adminTab === tab);
    });

    [...adminContent.children].forEach(section => {
      if(section.id === "adminSubTabs") return;
      section.classList.toggle("admin-section-hidden", section.dataset.adminGroup !== tab);
    });

    localStorage.setItem("gbAdminSubTab", tab);

    if(tab === "items" && typeof renderItemManageTable === "function") {
      setTimeout(renderItemManageTable, 50);
    }
    if(tab === "orders" && typeof renderAdminOrders === "function") {
      setTimeout(renderAdminOrders, 50);
    }
    if(tab === "costs" && typeof renderCostReport === "function") {
      setTimeout(renderCostReport, 50);
    }
  }

  function applyAdminTabStyles(){
    if(document.getElementById("gbAdminTabsCss")) return;

    const style = document.createElement("style");
    style.id = "gbAdminTabsCss";
    style.textContent = `
      .admin-sub-tabs{
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:10px;
        margin:0 0 18px;
        position:sticky;
        top:0;
        z-index:40;
        background:rgba(248,247,243,.96);
        padding:10px 0;
        backdrop-filter:blur(8px);
      }
      .admin-sub-tab{
        border:1px solid var(--line);
        background:#fff;
        color:var(--text);
        border-radius:16px;
        padding:12px 10px;
        font-weight:800;
        cursor:pointer;
        box-shadow:0 3px 10px rgba(0,0,0,.04);
      }
      .admin-sub-tab.active{
        background:var(--main);
        color:#fff;
        border-color:var(--main);
      }
      .admin-section-hidden{
        display:none !important;
      }
      @media(max-width:760px){
        .admin-sub-tabs{
          grid-template-columns:1fr;
          gap:8px;
          position:relative;
          top:auto;
        }
        .admin-sub-tab{
          padding:11px 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    applyAdminTabStyles();
    setTimeout(ensureAdminTabs,300);
    setTimeout(ensureAdminTabs,1000);
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    applyAdminTabStyles();
    ensureAdminTabs();
  };

  window.gbSwitchAdminSubTab = switchAdminSubTab;
})();

/* GoldenBird Inventory v2.2.12｜手動叫貨自動選取送出修正 */
(function(){
  function gbGetManualOrderInput(){
    return document.getElementById("manualOrderItemSearch")
      || document.querySelector('input[placeholder*="內部品項"]');
  }

  function gbGetManualOrderItemSelect(){
    return document.getElementById("manualOrderItemSelect")
      || document.getElementById("manualOrderItemId")
      || document.getElementById("orderItemId")
      || document.getElementById("newOrderItemId");
  }

  function gbNormalize(text){
    return String(text || "").toLowerCase().replace(/\s+/g,"");
  }

  function gbResolveManualOrderItem(){
    const input = gbGetManualOrderInput();
    if(!input || typeof data === "undefined" || !Array.isArray(data.items)) return null;

    const selectedId = input.dataset.selectedItemId;
    if(selectedId){
      const selected = data.items.find(item => item.id === selectedId && !item.disabled);
      if(selected) return selected;
    }

    const keyword = gbNormalize(input.value);
    if(!keyword) return null;

    const exact = data.items.find(item => !item.disabled && gbNormalize(item.name) === keyword);
    if(exact) return exact;

    const partial = data.items.filter(item => !item.disabled && gbNormalize(item.name).includes(keyword));
    if(partial.length === 1) return partial[0];

    return null;
  }

  function gbApplyManualOrderItem(item){
    if(!item) return false;

    const input = gbGetManualOrderInput();
    const select = gbGetManualOrderItemSelect();

    if(input){
      input.value = item.name;
      input.dataset.selectedItemId = item.id;
      input.dataset.selectedItemName = item.name;
    }

    if(select){
      select.value = item.id;
    }

    return true;
  }

  // 修正 v2.2.10 的建議清單點選後，必須同步寫入 manualOrderItemSelect
  const oldGbBindOrderAutocomplete = window.gbBindOrderAutocomplete;
  window.gbBindOrderAutocomplete = function(){
    if(typeof oldGbBindOrderAutocomplete === "function") oldGbBindOrderAutocomplete();

    const suggestBox = document.getElementById("orderItemSuggestBox");
    if(suggestBox){
      suggestBox.querySelectorAll(".order-suggest-item[data-id]").forEach(btn=>{
        btn.onclick = () => {
          const item = data.items.find(i => i.id === btn.dataset.id);
          gbApplyManualOrderItem(item);
          suggestBox.classList.add("hidden");
          suggestBox.innerHTML = "";
          if(typeof showToast === "function" && item) showToast(`已選取：${item.name}`);
        };
      });
    }
  };

  const oldAddManualOrderV2212 = addManualOrder;
  addManualOrder = function(){
    const input = gbGetManualOrderInput();
    const select = gbGetManualOrderItemSelect();

    if(input && input.value.trim()){
      const item = gbResolveManualOrderItem();

      if(item){
        gbApplyManualOrderItem(item);
      }else if(!select?.value){
        if(typeof showToast === "function") showToast("請先從候選清單選取正確品項");
        if(typeof gbBindOrderAutocomplete === "function") gbBindOrderAutocomplete();
        return;
      }
    }

    oldAddManualOrderV2212();
  };

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(()=>{ if(typeof window.gbBindOrderAutocomplete === "function") window.gbBindOrderAutocomplete(); },500);
  });

  const oldRenderAllV2212 = renderAll;
  renderAll = function(){
    oldRenderAllV2212();
    if(typeof window.gbBindOrderAutocomplete === "function") window.gbBindOrderAutocomplete();
  };

  window.gbDiagnosticOrder = function(){
    const input = gbGetManualOrderInput();
    const select = gbGetManualOrderItemSelect();
    return {
      inputFound: !!input,
      selectFound: !!select,
      inputValue: input?.value,
      selectedItemId: input?.dataset.selectedItemId,
      selectValue: select?.value,
      resolvedItem: gbResolveManualOrderItem()?.name || null
    };
  };
})();

/* GoldenBird Inventory v2.3.0｜運費與人民幣換算 */
(function(){
  const GB_CNY_RATE_KEY = "gb_cny_twd_rate_cache_v1";
  const DEFAULT_CNY_TWD_RATE = 4.45;

  function getManualOrderCurrency(){
    return document.getElementById("manualOrderCurrency")?.value || "TWD";
  }

  function getManualCostValue(){
    return Number(document.getElementById("manualOrderCost")?.value || 0) || 0;
  }

  function getManualFreightValue(){
    return Number(document.getElementById("manualOrderFreight")?.value || 0) || 0;
  }

  function getCachedCnyRate(){
    try{
      const raw = localStorage.getItem(GB_CNY_RATE_KEY);
      if(!raw) return null;
      const cache = JSON.parse(raw);
      if(!cache || !cache.rate) return null;
      const age = Date.now() - Number(cache.time || 0);
      if(age > 1000 * 60 * 60 * 12) return null;
      return Number(cache.rate);
    }catch(error){
      return null;
    }
  }

  function setCachedCnyRate(rate){
    if(!rate || Number.isNaN(rate)) return;
    localStorage.setItem(GB_CNY_RATE_KEY, JSON.stringify({
      rate,
      time: Date.now()
    }));
  }

  async function fetchCnyTwdRate(){
    const cached = getCachedCnyRate();
    if(cached) return cached;

    // 使用公開匯率 API。若失敗，使用備用匯率，避免叫貨流程中斷。
    try{
      const res = await fetch("https://open.er-api.com/v6/latest/CNY", { cache: "no-store" });
      const json = await res.json();
      const rate = Number(json?.rates?.TWD);
      if(rate && !Number.isNaN(rate)){
        setCachedCnyRate(rate);
        return rate;
      }
    }catch(error){
      console.warn("CNY rate fetch failed, fallback used.", error);
    }

    return DEFAULT_CNY_TWD_RATE;
  }

  async function updateManualOrderFxPreview(){
    const preview = document.getElementById("manualOrderFxPreview");
    if(!preview) return;

    const cost = getManualCostValue();
    const freight = getManualFreightValue();
    const subtotal = cost + freight;
    const currency = getManualOrderCurrency();

    if(currency === "TWD"){
      preview.value = `台幣合計 NT$ ${Math.round(subtotal)}`;
      return;
    }

    preview.value = "匯率讀取中…";
    const rate = await fetchCnyTwdRate();
    const twd = Math.round(subtotal * rate);
    preview.value = `1 CNY ≈ NT$ ${rate.toFixed(3)}｜合計 NT$ ${twd}`;
  }

  async function calculateManualOrderTotalTwd(){
    const cost = getManualCostValue();
    const freight = getManualFreightValue();
    const subtotal = cost + freight;
    const currency = getManualOrderCurrency();

    if(currency === "CNY"){
      const rate = await fetchCnyTwdRate();
      return {
        costOriginal: cost,
        freightOriginal: freight,
        currency,
        fxRate: rate,
        costTwd: Math.round(cost * rate),
        freightTwd: Math.round(freight * rate),
        totalTwd: Math.round(subtotal * rate)
      };
    }

    return {
      costOriginal: cost,
      freightOriginal: freight,
      currency: "TWD",
      fxRate: 1,
      costTwd: Math.round(cost),
      freightTwd: Math.round(freight),
      totalTwd: Math.round(subtotal)
    };
  }

  function bindFreightCurrencyUi(){
    ["manualOrderCost","manualOrderFreight","manualOrderCurrency"].forEach(id=>{
      const el = document.getElementById(id);
      if(el && el.dataset.fxBound !== "true"){
        el.addEventListener("input", updateManualOrderFxPreview);
        el.addEventListener("change", updateManualOrderFxPreview);
        el.dataset.fxBound = "true";
      }
    });
    updateManualOrderFxPreview();
  }

  const oldAddManualOrder = addManualOrder;
  addManualOrder = async function(){
    const itemSelect = document.getElementById("manualOrderItemSelect");
    const itemIdBefore = itemSelect?.value || "";

    // 先讓前面的自動選取修正有機會把品項 ID 寫入欄位
    const searchInput = document.getElementById("manualOrderItemSearch");
    if(searchInput && !itemIdBefore && typeof window.gbBindOrderAutocomplete === "function"){
      window.gbBindOrderAutocomplete();
    }

    const itemId = document.getElementById("manualOrderItemSelect")?.value;
    const qty = Number(document.getElementById("manualOrderQty")?.value);
    const source = document.getElementById("manualOrderSource")?.value.trim() || "手動新增";
    const dateInput = document.getElementById("manualOrderDate")?.value;
    const item = getItem(itemId);

    if(!item){
      showToast("請先搜尋並選擇品項");
      return;
    }

    if(!qty || qty <= 0){
      showToast("請輸入正確叫貨數量");
      return;
    }

    const converted = await calculateManualOrderTotalTwd();
    if(Number.isNaN(converted.totalTwd) || converted.totalTwd < 0){
      showToast("請輸入正確成本與運費");
      return;
    }

    const role = document.getElementById("roleSelect")?.value || window.GB_AUTH?.role || "staff";
    const person = role === "qing" ? "青" : (role === "emily" ? "Emily" : "老闆");

    const newOrder = {
      id: `O${Date.now()}`,
      date: dateInput || new Date().toISOString().slice(0, 10),
      itemId,
      qty,
      received: 0,
      cost: converted.totalTwd,
      productCost: converted.costTwd,
      freight: converted.freightTwd,
      originalCost: converted.costOriginal,
      originalFreight: converted.freightOriginal,
      currency: converted.currency,
      fxRate: converted.fxRate,
      source,
      person,
      status: "在途"
    };

    data.orders.unshift(newOrder);
    lastCreatedOrderId = newOrder.id;

    saveData();
    renderAll();

    ["manualOrderItemSearch","manualOrderItemSelect","manualOrderQty","manualOrderCost","manualOrderFreight","manualOrderSource","manualOrderDate"].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.value = "";
    });

    const currency = document.getElementById("manualOrderCurrency");
    if(currency) currency.value = "TWD";
    updateManualOrderFxPreview();

    showToast(`${item.name} 已新增叫貨，成本含運費 NT$ ${converted.totalTwd}`);
  };

  const oldRenderAdminOrders = renderAdminOrders;
  renderAdminOrders = function(){
    oldRenderAdminOrders();

    document.querySelectorAll("#adminOrdersTable tr").forEach(row=>{
      const cells = row.querySelectorAll("td");
      if(cells.length < 5) return;

      const orderName = cells[1]?.textContent?.trim();
      const matching = (data.orders || []).find(order => {
        const item = getItem(order.itemId);
        return item && item.name === orderName;
      });

      if(matching && Number(matching.freight || 0) > 0){
        const costCell = cells[4];
        const product = Number(matching.productCost || 0);
        const freight = Number(matching.freight || 0);
        const currencyText = matching.currency === "CNY"
          ? `<br><small>原幣 CNY ${matching.originalCost || 0} + 運 ${matching.originalFreight || 0}｜匯率 ${Number(matching.fxRate || 0).toFixed(3)}</small>`
          : "";
        costCell.innerHTML = `NT$ ${matching.cost || 0}<br><small>商品 ${product}｜運費 ${freight}</small>${currencyText}`;
      }
    });
  };

  const oldRenderCostReport = renderCostReport;
  renderCostReport = function(){
    oldRenderCostReport();
    const yearTotal = document.getElementById("yearTotalCost");
    if(yearTotal && !yearTotal.placeholder){
      yearTotal.title = "總進貨成本已包含商品成本與運費";
    }
  };

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(bindFreightCurrencyUi, 300);
    setTimeout(bindFreightCurrencyUi, 1000);
  });

  const oldRenderAll = renderAll;
  renderAll = function(){
    oldRenderAll();
    bindFreightCurrencyUi();
  };

  window.gbUpdateManualOrderFxPreview = updateManualOrderFxPreview;
})();

/* GoldenBird Inventory v2.3.1｜叫貨新增送出修正 */
(function(){
  function gbGetOrderItemBySearch(){
    const input = document.getElementById("manualOrderItemSearch")
      || document.querySelector('input[placeholder*="內部品項"]');
    const select = document.getElementById("manualOrderItemSelect");

    if(select?.value){
      const item = data.items.find(i => i.id === select.value && !i.disabled);
      if(item) return item;
    }

    const selectedId = input?.dataset?.selectedItemId;
    if(selectedId){
      const item = data.items.find(i => i.id === selectedId && !i.disabled);
      if(item) return item;
    }

    const keyword = String(input?.value || "").trim().toLowerCase().replace(/\s+/g,"");
    if(!keyword) return null;

    const exact = data.items.find(i => !i.disabled && String(i.name || "").trim().toLowerCase().replace(/\s+/g,"") === keyword);
    if(exact) return exact;

    const partial = data.items.filter(i => !i.disabled && String(i.name || "").trim().toLowerCase().replace(/\s+/g,"").includes(keyword));
    return partial.length === 1 ? partial[0] : null;
  }

  async function gbGetCnyRateV231(){
    try{
      const cached = localStorage.getItem("gb_cny_twd_rate_cache_v1");
      if(cached){
        const obj = JSON.parse(cached);
        if(obj?.rate && Date.now() - Number(obj.time || 0) < 1000 * 60 * 60 * 12) return Number(obj.rate);
      }
    }catch(error){}

    try{
      const res = await fetch("https://open.er-api.com/v6/latest/CNY", {cache:"no-store"});
      const json = await res.json();
      const rate = Number(json?.rates?.TWD);
      if(rate){
        localStorage.setItem("gb_cny_twd_rate_cache_v1", JSON.stringify({rate, time:Date.now()}));
        return rate;
      }
    }catch(error){
      console.warn("CNY rate fetch failed.", error);
    }

    return 4.45;
  }

  async function gbCalculateOrderCostV231(){
    const productCost = Number(document.getElementById("manualOrderCost")?.value || 0) || 0;
    const freight = Number(document.getElementById("manualOrderFreight")?.value || 0) || 0;
    const currency = document.getElementById("manualOrderCurrency")?.value || "TWD";

    if(currency === "CNY"){
      const rate = await gbGetCnyRateV231();
      return {
        currency,
        fxRate: rate,
        originalCost: productCost,
        originalFreight: freight,
        productCost: Math.round(productCost * rate),
        freight: Math.round(freight * rate),
        total: Math.round((productCost + freight) * rate)
      };
    }

    return {
      currency: "TWD",
      fxRate: 1,
      originalCost: productCost,
      originalFreight: freight,
      productCost: Math.round(productCost),
      freight: Math.round(freight),
      total: Math.round(productCost + freight)
    };
  }

  async function gbSubmitManualOrderV231(){
    const item = gbGetOrderItemBySearch();
    const qty = Number(document.getElementById("manualOrderQty")?.value || 0);
    const source = document.getElementById("manualOrderSource")?.value.trim() || "手動新增";
    const date = document.getElementById("manualOrderDate")?.value || new Date().toISOString().slice(0,10);

    if(!item){
      showToast("請先搜尋並選擇品項");
      return;
    }

    if(!qty || qty <= 0){
      showToast("請輸入正確叫貨數量");
      return;
    }

    const cost = await gbCalculateOrderCostV231();

    if(Number.isNaN(cost.total) || cost.total < 0){
      showToast("請輸入正確商品成本與運費");
      return;
    }

    const role = String(window.GB_AUTH?.role || document.getElementById("roleSelect")?.value || "staff").toLowerCase();
    const person = role === "qing" ? "青" : role === "emily" ? "Emily" : role === "boss" ? "老闆" : (window.GB_AUTH?.user?.displayName || "員工");

    const newOrder = {
      id: `O${Date.now()}`,
      date,
      itemId: item.id,
      qty,
      received: 0,
      cost: cost.total,
      productCost: cost.productCost,
      freight: cost.freight,
      originalCost: cost.originalCost,
      originalFreight: cost.originalFreight,
      currency: cost.currency,
      fxRate: cost.fxRate,
      source,
      person,
      status: "在途"
    };

    data.orders.unshift(newOrder);
    lastCreatedOrderId = newOrder.id;

    saveData();
    renderAll();

    const fields = ["manualOrderItemSearch","manualOrderQty","manualOrderCost","manualOrderFreight","manualOrderSource","manualOrderDate"];
    fields.forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.value = "";
    });

    const select = document.getElementById("manualOrderItemSelect");
    if(select) select.value = "";

    const currency = document.getElementById("manualOrderCurrency");
    if(currency) currency.value = "TWD";

    const preview = document.getElementById("manualOrderFxPreview");
    if(preview) preview.value = "台幣合計 NT$ 0";

    showToast(`${item.name} 已新增叫貨，成本含運費 NT$ ${cost.total}`);
  }

  function gbBindManualOrderSubmitV231(){
    const btn = document.getElementById("addManualOrderBtn")
      || document.querySelector('button[onclick*="addManualOrder"]')
      || [...document.querySelectorAll("button")].find(b => (b.textContent || "").includes("新增叫貨紀錄"));

    if(btn){
      btn.onclick = function(event){
        event.preventDefault();
        gbSubmitManualOrderV231();
      };
    }
  }

  // 覆蓋全域函式，避免舊事件呼叫到舊版流程
  window.addManualOrder = gbSubmitManualOrderV231;
  addManualOrder = gbSubmitManualOrderV231;

  document.addEventListener("DOMContentLoaded",()=>{
    gbBindManualOrderSubmitV231();
    setTimeout(gbBindManualOrderSubmitV231,300);
    setTimeout(gbBindManualOrderSubmitV231,1000);
  });

  const oldRenderAllV231 = renderAll;
  renderAll = function(){
    oldRenderAllV231();
    gbBindManualOrderSubmitV231();
  };

  window.gbSubmitManualOrderV231 = gbSubmitManualOrderV231;
})();

/* GoldenBird Inventory v2.3.2｜在途商品欄位對齊修正 */
(function(){
  function renderIncoming() {
    const tbody = document.getElementById("incomingTable");
    if (!tbody) return;

    const activeOrders = (data.orders || []).filter(order => Number(order.qty) - Number(order.received) > 0);

    tbody.innerHTML = activeOrders.map(order => {
      const item = getItem(order.itemId);
      const remain = Math.max(0, Number(order.qty) - Number(order.received));
      const statusClass = order.status === "部分到貨" ? "warn" : "info";

      return `
        <tr class="${order.id === lastCreatedOrderId ? "highlight-row" : ""}">
          <td>${order.date || ""}</td>
          <td>${item ? escapeHtml(item.name) : escapeHtml(order.deletedItemName || "已刪除品項")}</td>
          <td>${Number(order.qty) || 0}</td>
          <td>${Number(order.received) || 0}</td>
          <td>${remain}</td>
          <td>${escapeHtml(order.person || "-")}</td>
          <td><span class="badge ${statusClass}">${order.status || "在途"}</span></td>
          <td><input class="receive-input" data-id="${order.id}" type="number" min="1" max="${remain}" placeholder="數量"></td>
          <td><button class="small receive-btn" data-id="${order.id}">確認到貨</button></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="9">目前沒有在途商品</td></tr>`;

    document.querySelectorAll(".receive-btn").forEach(button => {
      button.onclick = () => receiveOrder(button.dataset.id);
    });
  }

  function applyIncomingTableFixStyle(){
    if(document.getElementById("gbV232IncomingCss")) return;

    const style = document.createElement("style");
    style.id = "gbV232IncomingCss";
    style.textContent = `
      #incomingTable input.receive-input{
        width:86px;
        min-width:70px;
        box-sizing:border-box;
      }

      #incomingTable .receive-btn{
        white-space:nowrap;
        min-width:96px;
      }

      #incoming .table-scroll,
      #incoming table{
        overflow-x:auto;
      }

      #incoming table th,
      #incoming table td{
        white-space:nowrap;
        vertical-align:middle;
      }

      @media(max-width:760px){
        #incoming .table-scroll{
          overflow-x:auto;
          -webkit-overflow-scrolling:touch;
        }

        #incoming table{
          min-width:820px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // 覆蓋全域 renderIncoming，避免舊版多出成本欄造成錯位
  window.renderIncoming = renderIncoming;

  document.addEventListener("DOMContentLoaded",()=>{
    applyIncomingTableFixStyle();
    setTimeout(renderIncoming,300);
  });

  const oldRenderAllV232 = renderAll;
  renderAll = function(){
    oldRenderAllV232();
    applyIncomingTableFixStyle();
    renderIncoming();
  };
})();

/* GoldenBird Inventory v2.3.3｜Excel 匯出欄位正式版 */
(function(){
  function gbOrderItemName(order){
    const item = (data.items || []).find(row => row.id === order.itemId);
    return item?.name || order.itemName || order.deletedItemName || "";
  }

  function gbOrderItemCategory(order){
    const item = (data.items || []).find(row => row.id === order.itemId);
    return item?.category || "";
  }

  function gbOrderStatus(order){
    const remain = Math.max(0, Number(order.qty || 0) - Number(order.received || 0));
    if(order.status === "done" || remain === 0) return "已到貨";
    if(Number(order.received || 0) > 0) return "部分到貨";
    return order.status || "在途";
  }

  function gbProductCostTwd(order){
    if(order.productCost !== undefined) return Number(order.productCost) || 0;
    return Number(order.cost) || 0;
  }

  function gbFreightTwd(order){
    return Number(order.freight) || 0;
  }

  function gbTotalCostTwd(order){
    if(order.cost !== undefined) return Number(order.cost) || 0;
    return gbProductCostTwd(order) + gbFreightTwd(order);
  }

  function buildExcelRows() {
    const items = data.items || [];
    const orders = data.orders || [];
    const history = data.history || [];

    const inventoryRows = items
      .filter(item => !item.disabled)
      .map(item => {
        const transitQty = getTransitQuantityForItem(item.id);
        const stock = Number(item.stock) || 0;
        const safety = Number(item.safety) || 0;
        return {
          "品項ID": item.id,
          "品項名稱": item.name,
          "分類": item.category || "",
          "管理部門": item.dept || "",
          "目前庫存": stock,
          "在途數量": transitQty,
          "安全庫存": safety,
          "狀態": item.disabled ? "停用" : "啟用",
          "是否需補貨": stock < safety ? "是" : "否",
          "建議補貨數": Math.max(safety - stock, 0),
          "最後更新人": item.lastUpdatedBy || "",
          "最後更新Email": item.lastUpdatedEmail || "",
          "最後更新時間": item.lastUpdatedAt ? formatDateTime(item.lastUpdatedAt) : "",
          "最後更新類型": item.lastUpdateType || "",
          "備註": item.note || ""
        };
      });

    const allItemRows = items.map(item => ({
      "品項ID": item.id,
      "品項名稱": item.name,
      "分類": item.category || "",
      "管理部門": item.dept || "",
      "目前庫存": Number(item.stock) || 0,
      "安全庫存": Number(item.safety) || 0,
      "狀態": item.disabled ? "停用" : "啟用",
      "最後更新人": item.lastUpdatedBy || "",
      "最後更新時間": item.lastUpdatedAt ? formatDateTime(item.lastUpdatedAt) : "",
      "備註": item.note || ""
    }));

    const transitRows = orders.map(order => ({
      "叫貨ID": order.id || "",
      "叫貨日期": order.date || "",
      "品項ID": order.itemId || "",
      "品項名稱": gbOrderItemName(order),
      "分類": gbOrderItemCategory(order),
      "叫貨數量": Number(order.qty) || 0,
      "已到貨": Number(order.received) || 0,
      "剩餘在途": Math.max(0, Number(order.qty || 0) - Number(order.received || 0)),
      "商品成本": gbProductCostTwd(order),
      "運費": gbFreightTwd(order),
      "台幣合計": gbTotalCostTwd(order),
      "原始幣別": order.currency || "TWD",
      "原始商品成本": order.originalCost ?? gbProductCostTwd(order),
      "原始運費": order.originalFreight ?? gbFreightTwd(order),
      "匯率": order.fxRate || 1,
      "來源": order.source || "",
      "叫貨人": order.person || "",
      "狀態": gbOrderStatus(order),
      "備註": order.note || ""
    }));

    const costRows = items.map(item => {
      const related = orders.filter(order => order.itemId === item.id && gbTotalCostTwd(order) > 0);
      const totalCost = related.reduce((sum, order) => sum + gbTotalCostTwd(order), 0);
      const productCost = related.reduce((sum, order) => sum + gbProductCostTwd(order), 0);
      const freightCost = related.reduce((sum, order) => sum + gbFreightTwd(order), 0);
      const totalQty = related.reduce((sum, order) => sum + (Number(order.qty) || 0), 0);
      return {
        "品項ID": item.id,
        "品項名稱": item.name,
        "分類": item.category || "",
        "商品成本合計": productCost,
        "運費合計": freightCost,
        "進貨成本合計": totalCost,
        "累計數量": totalQty,
        "平均單位成本": totalQty ? Math.round((totalCost / totalQty) * 100) / 100 : ""
      };
    });

    const reorderRows = items
      .filter(item => !item.disabled && (Number(item.stock) || 0) < (Number(item.safety) || 0))
      .map(item => ({
        "品項ID": item.id,
        "品項名稱": item.name,
        "分類": item.category || "",
        "目前庫存": Number(item.stock) || 0,
        "安全庫存": Number(item.safety) || 0,
        "建議補貨數": Math.max((Number(item.safety) || 0) - (Number(item.stock) || 0), 0),
        "在途數量": getTransitQuantityForItem(item.id),
        "管理部門": item.dept || ""
      }));

    const historyRows = history.map(record => ({
      "時間": record.time ? formatDateTime(record.time) : "",
      "品項ID": record.itemId || "",
      "品項名稱": record.itemName || "",
      "原庫存": normalizeForExcel(record.oldStock),
      "新庫存": normalizeForExcel(record.newStock),
      "異動": normalizeForExcel(record.change),
      "類型": record.type || "",
      "操作人": record.user || "",
      "Email": record.email || "",
      "備註": record.note || ""
    }));

    const infoRows = [{
      "匯出時間": formatDateTime(Date.now()),
      "匯出人": getCurrentUserLabel ? getCurrentUserLabel() : "",
      "匯出Email": getCurrentUserEmail ? getCurrentUserEmail() : "",
      "資料版本": "v2.3.3 Excel Export",
      "備註": "由金雀庫存管理系統自動匯出；進貨成本已拆分商品成本、運費與台幣合計"
    }];

    return {
      "目前庫存": inventoryRows,
      "在途商品": transitRows,
      "成本": costRows,
      "補貨建議": reorderRows,
      "所有品項": allItemRows,
      "庫存異動": historyRows,
      "系統資訊": infoRows
    };
  }

  window.buildExcelRows = buildExcelRows;
})();

/* GoldenBird Inventory v2.3.4｜最近庫存異動聯動修正 */
(function(){
  function gbNow(){
    return Date.now();
  }

  function gbCurrentUserLabelSafe(){
    try{
      if(typeof getCurrentUserLabel === "function") return getCurrentUserLabel();
    }catch(error){}
    const role = String(window.GB_AUTH?.role || document.getElementById("roleSelect")?.value || "").toLowerCase();
    if(role === "emily") return "Emily";
    if(role === "qing") return "青";
    if(role === "boss") return "老闆";
    return window.GB_AUTH?.user?.displayName || "員工";
  }

  function gbCurrentUserEmailSafe(){
    try{
      if(typeof getCurrentUserEmail === "function") return getCurrentUserEmail();
    }catch(error){}
    return window.GB_AUTH?.user?.email || "";
  }

  function gbPushHistory(item, oldStock, newStock, type, note){
    if(!item) return;

    data.history = Array.isArray(data.history) ? data.history : [];

    const oldQty = Number(oldStock) || 0;
    const newQty = Number(newStock) || 0;

    const record = {
      id: `H${Date.now()}${Math.floor(Math.random()*1000)}`,
      time: gbNow(),
      itemId: item.id,
      itemName: item.name,
      oldStock: oldQty,
      newStock: newQty,
      change: newQty - oldQty,
      type: type || "庫存異動",
      user: gbCurrentUserLabelSafe(),
      email: gbCurrentUserEmailSafe(),
      note: note || ""
    };

    data.history.unshift(record);
    data.history = data.history.slice(0, 1000);

    item.lastUpdatedBy = record.user;
    item.lastUpdatedEmail = record.email;
    item.lastUpdatedAt = record.time;
    item.lastUpdateType = record.type;
  }

  // 覆蓋 addStockHistory，確保所有呼叫都有寫入最近庫存異動
  window.addStockHistory = function(item, oldStock, newStock, type, note){
    gbPushHistory(item, oldStock, newStock, type, note);
  };
  addStockHistory = window.addStockHistory;

  function gbRefreshHistoryViews(){
    if(typeof renderHistoryPage === "function"){
      try{ renderHistoryPage(); }catch(error){ console.warn(error); }
    }
    if(typeof renderStockHistory === "function"){
      try{ renderStockHistory(); }catch(error){ console.warn(error); }
    }
  }

  // 修正快速盤點：更新後確保異動頁刷新
  if(typeof confirmQuickStockUpdate === "function"){
    const oldConfirmQuickStockUpdate = confirmQuickStockUpdate;
    confirmQuickStockUpdate = function(){
      oldConfirmQuickStockUpdate();
      gbRefreshHistoryViews();
    };
    window.confirmQuickStockUpdate = confirmQuickStockUpdate;
  }

  // 修正到貨：若舊版流程沒有寫 history，這裡補上
  if(typeof receiveOrder === "function"){
    const oldReceiveOrder = receiveOrder;
    receiveOrder = function(orderId){
      const order = (data.orders || []).find(row => row.id === orderId);
      const item = order ? getItem(order.itemId) : null;
      const oldStock = item ? Number(item.stock || 0) : null;

      oldReceiveOrder(orderId);

      const newItem = order ? getItem(order.itemId) : null;
      if(newItem && oldStock !== null && Number(newItem.stock || 0) !== oldStock){
        const already = (data.history || [])[0];
        const recentEnough = already && already.itemId === newItem.id && Math.abs(Date.now() - Number(already.time || 0)) < 1500;
        if(!recentEnough){
          gbPushHistory(newItem, oldStock, Number(newItem.stock || 0), "到貨入庫", "在途商品確認到貨");
          saveData();
        }
      }

      gbRefreshHistoryViews();
    };
    window.receiveOrder = receiveOrder;
  }

  // 修正新增品項初始庫存：若有初始庫存但未寫 history，補上
  if(typeof createNewItem === "function"){
    const oldCreateNewItem = createNewItem;
    createNewItem = function(args){
      const beforeIds = new Set((data.items || []).map(item => item.id));
      oldCreateNewItem(args);

      const created = (data.items || []).find(item => !beforeIds.has(item.id));
      if(created && Number(created.stock || 0) > 0){
        const already = (data.history || [])[0];
        const recentEnough = already && already.itemId === created.id && Math.abs(Date.now() - Number(already.time || 0)) < 1500;
        if(!recentEnough){
          gbPushHistory(created, 0, Number(created.stock || 0), "新增品項", "初始庫存");
          saveData();
        }
      }

      gbRefreshHistoryViews();
    };
    window.createNewItem = createNewItem;
  }

  const oldRenderAllV234 = renderAll;
  renderAll = function(){
    oldRenderAllV234();
    gbRefreshHistoryViews();
  };

  document.addEventListener("DOMContentLoaded", ()=>{
    setTimeout(gbRefreshHistoryViews, 300);
    setTimeout(gbRefreshHistoryViews, 1000);
  });

  window.gbDiagnosticHistory = function(){
    return {
      historyCount: Array.isArray(data.history) ? data.history.length : 0,
      latest: Array.isArray(data.history) ? data.history[0] : null,
      currentTab,
      historyListFound: !!document.getElementById("historyPageList")
    };
  };
})();


/* GoldenBird Inventory v3.0 Stable｜正式整合版標記 */
window.GB_VERSION = "goldenbird-inventory-v3.0-stable";


/* GoldenBird Inventory v3.0.1｜Firebase 重複宣告修正 */
window.GB_VERSION = "goldenbird-inventory-v3.0.1-firebase-duplicate-fix";

/* GoldenBird Inventory v3.0.2｜同步錯誤診斷修正 */
(function(){
  function gbSetSyncError(error, stage){
    window.lastSyncError = {
      stage,
      code: error?.code || "",
      message: error?.message || String(error || ""),
      name: error?.name || "",
      time: new Date().toISOString()
    };

    console.error("GB Firestore sync error:", window.lastSyncError, error);

    const el = document.getElementById("syncStatusText");
    if(el){
      if(error?.code === "permission-denied"){
        el.textContent = "同步失敗：權限不足";
      }else if(error?.code === "unavailable"){
        el.textContent = "同步失敗：網路異常";
      }else{
        el.textContent = "同步失敗";
      }
      el.classList.remove("ok","warn");
      el.classList.add("bad");
    }
  }

  function gbDescribeSyncError(){
    const e = window.lastSyncError;
    if(!e) return "目前沒有記錄到同步錯誤。";

    if(e.code === "permission-denied"){
      return "Firestore 權限不足。請檢查 Firebase Firestore Rules 是否允許此登入帳號讀寫 system/main。";
    }

    if(e.code === "unavailable"){
      return "Firestore 暫時無法連線，通常是網路或 Firebase 服務暫時問題。";
    }

    return `${e.stage || "sync"}｜${e.code || "no-code"}｜${e.message || ""}`;
  }

  function gbStartRemoteSyncDiagnostic(){
    const ref = getMainDocRef();
    if(!ref){
      updateSyncStatus("未連線", "warn");
      window.lastSyncError = {
        stage: "getMainDocRef",
        code: "no-ref",
        message: "GB_FIREBASE.db 尚未準備好，或 getMainDocRef 無法取得 Firestore 文件。",
        time: new Date().toISOString()
      };
      return;
    }

    if(gbUnsubscribeMainDoc){
      try{ gbUnsubscribeMainDoc(); }catch(error){ console.warn(error); }
    }

    updateSyncStatus("同步連線中…", "warn");
    window.lastSyncError = null;

    const applySnapshot = snapshot => {
      try{
        if(!snapshot.exists){
          return false;
        }

        const remoteData = normalizeRemoteData(snapshot.data());
        if(!remoteData){
          window.lastSyncError = {
            stage: "normalizeRemoteData",
            code: "empty-payload",
            message: "Firestore 文件存在，但沒有 payload 資料。",
            time: new Date().toISOString()
          };
          updateSyncStatus("同步失敗：資料格式", "bad");
          return false;
        }

        gbIsApplyingRemote = true;
        data = remoteData;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        gbRemoteReady = true;
        gbIsApplyingRemote = false;
        updateSyncStatus("已同步", "ok");
        renderAll();
        return true;
      }catch(error){
        gbIsApplyingRemote = false;
        gbSetSyncError(error, "applySnapshot");
        return false;
      }
    };

    ref.get()
      .then(snapshot => {
        if(snapshot.exists){
          applySnapshot(snapshot);
          return null;
        }

        return ref.set({
          payload: data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: window.GB_AUTH?.user?.email || "unknown",
          version: window.GB_VERSION || "v3.0.2"
        }, { merge: true }).then(() => {
          gbRemoteReady = true;
          updateSyncStatus("已同步", "ok");
        });
      })
      .then(() => {
        gbUnsubscribeMainDoc = ref.onSnapshot(snapshot => {
          if(!snapshot.exists) return;
          applySnapshot(snapshot);
        }, error => gbSetSyncError(error, "onSnapshot"));
      })
      .catch(error => gbSetSyncError(error, "initial get/set"));
  }

  // 覆蓋同步函式，保留原資料結構
  window.startRemoteSync = gbStartRemoteSyncDiagnostic;
  startRemoteSync = gbStartRemoteSyncDiagnostic;

  window.gbSyncDebug = function(){
    return {
      syncText: document.getElementById("syncStatusText")?.textContent,
      firebaseReady: !!window.GB_FIREBASE?.ready,
      authReady: !!window.GB_AUTH?.ready,
      user: window.GB_AUTH?.user,
      role: window.GB_AUTH?.role,
      docPath: typeof GB_SYNC_DOC_PATH !== "undefined" ? GB_SYNC_DOC_PATH : "",
      hasDb: !!window.GB_FIREBASE?.db,
      lastSyncError: window.lastSyncError,
      suggestion: gbDescribeSyncError()
    };
  };

  window.gbRetrySync = function(){
    window.lastSyncError = null;
    gbStartRemoteSyncDiagnostic();
  };

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(()=>{
      if(document.getElementById("syncStatusText")?.textContent !== "已同步"){
        gbStartRemoteSyncDiagnostic();
      }
    }, 1200);
  });
})();

/* GoldenBird Inventory v3.0.4｜後台分頁安全修正＋同步診斷文字 */
(function(){
  // 先建立診斷文字函式，避免後續任何錯誤導致無法查同步
  window.gbSyncDebugText = function(){
    let result = {};
    try{
      result = typeof gbSyncDebug === "function" ? gbSyncDebug() : {
        syncText: document.getElementById("syncStatusText")?.textContent,
        firebaseReady: !!window.GB_FIREBASE?.ready,
        authReady: !!window.GB_AUTH?.ready,
        user: window.GB_AUTH?.user || null,
        role: window.GB_AUTH?.role || null,
        hasDb: !!window.GB_FIREBASE?.db,
        lastSyncError: window.lastSyncError || null
      };
    }catch(error){
      result = {
        error: String(error),
        syncText: document.getElementById("syncStatusText")?.textContent,
        lastSyncError: window.lastSyncError || null
      };
    }
    return JSON.stringify(result, null, 2);
  };

  function findAdminSections(){
    const adminContent = document.getElementById("adminContent");
    if(!adminContent) return null;

    const all = [...adminContent.children].filter(el => el.id !== "adminSubTabs");

    const sections = {
      items: [],
      orders: [],
      costs: []
    };

    all.forEach(el => {
      const text = (el.textContent || "").trim();

      if(text.includes("品項管理") || text.includes("新增品項") || text.includes("停實建議停用")){
        sections.items.push(el);
        return;
      }

      if(text.includes("叫貨管理") || text.includes("手動新增叫貨") || text.includes("新增叫貨紀錄") || text.includes("叫貨紀錄")){
        sections.orders.push(el);
        return;
      }

      if(text.includes("資料匯出") || text.includes("成本報表") || text.includes("匯出 Excel") || text.includes("本月叫貨成本") || text.includes("成本")){
        sections.costs.push(el);
        return;
      }

      // 未明確判斷的區塊不要隱藏，避免功能消失
      el.dataset.adminGroup = "always";
    });

    sections.items.forEach(el => el.dataset.adminGroup = "items");
    sections.orders.forEach(el => el.dataset.adminGroup = "orders");
    sections.costs.forEach(el => el.dataset.adminGroup = "costs");

    return sections;
  }

  function ensureAdminTabsSafe(){
    const adminContent = document.getElementById("adminContent");
    if(!adminContent) return;

    let tabs = document.getElementById("adminSubTabs");
    if(!tabs){
      tabs = document.createElement("div");
      tabs.id = "adminSubTabs";
      tabs.className = "admin-sub-tabs";
      tabs.innerHTML = `
        <button type="button" class="admin-sub-tab active" data-admin-tab="items">📦 品項管理</button>
        <button type="button" class="admin-sub-tab" data-admin-tab="orders">🚚 叫貨管理</button>
        <button type="button" class="admin-sub-tab" data-admin-tab="costs">💰 成本報表</button>
      `;
      adminContent.insertAdjacentElement("afterbegin", tabs);
    }

    findAdminSections();

    tabs.querySelectorAll(".admin-sub-tab").forEach(btn=>{
      btn.onclick = () => switchAdminTabSafe(btn.dataset.adminTab);
    });

    switchAdminTabSafe(localStorage.getItem("gbAdminSubTab") || "items");
  }

  function switchAdminTabSafe(tab){
    const adminContent = document.getElementById("adminContent");
    const tabs = document.getElementById("adminSubTabs");
    if(!adminContent || !tabs) return;

    tabs.querySelectorAll(".admin-sub-tab").forEach(btn=>{
      btn.classList.toggle("active", btn.dataset.adminTab === tab);
    });

    [...adminContent.children].forEach(section=>{
      if(section.id === "adminSubTabs") return;
      const group = section.dataset.adminGroup || "always";
      section.classList.toggle("admin-section-hidden", group !== "always" && group !== tab);
    });

    localStorage.setItem("gbAdminSubTab", tab);

    if(tab === "items" && typeof renderItemManageTable === "function") setTimeout(renderItemManageTable, 50);
    if(tab === "orders" && typeof renderAdminOrders === "function") setTimeout(renderAdminOrders, 50);
    if(tab === "costs" && typeof renderCostReport === "function") setTimeout(renderCostReport, 50);
  }

  function applyAdminTabsSafeCss(){
    if(document.getElementById("gbAdminTabsSafeCss")) return;
    const style = document.createElement("style");
    style.id = "gbAdminTabsSafeCss";
    style.textContent = `
      .admin-sub-tabs{
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:10px;
        margin:0 0 18px;
        background:rgba(248,247,243,.96);
        padding:10px 0;
      }
      .admin-sub-tab{
        border:1px solid var(--line);
        background:#fff;
        color:var(--text);
        border-radius:16px;
        padding:12px 10px;
        font-weight:800;
        cursor:pointer;
      }
      .admin-sub-tab.active{
        background:var(--main);
        color:#fff;
        border-color:var(--main);
      }
      .admin-section-hidden{
        display:none !important;
      }
      @media(max-width:760px){
        .admin-sub-tabs{
          grid-template-columns:1fr;
          gap:8px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  window.gbSwitchAdminSubTab = switchAdminTabSafe;

  document.addEventListener("DOMContentLoaded",()=>{
    applyAdminTabsSafeCss();
    setTimeout(ensureAdminTabsSafe, 300);
    setTimeout(ensureAdminTabsSafe, 1000);
  });

  const oldRenderAllV304 = renderAll;
  renderAll = function(){
    oldRenderAllV304();
    applyAdminTabsSafeCss();
    ensureAdminTabsSafe();
  };
})();


/* GoldenBird Inventory v3.0.5｜缺失元素安全事件綁定修正 */
(function(){
  function safeBind(id, eventName, handler){
    const el = document.getElementById(id);
    if(!el) return false;
    el.addEventListener(eventName, handler);
    return true;
  }

  // 覆蓋容易因元素不存在而中斷的 bindEvents
  if(typeof bindEvents === "function"){
    const oldBindEvents = bindEvents;
    bindEvents = function(){
      try{
        oldBindEvents();
      }catch(error){
        console.warn("bindEvents safe fallback:", error);
      }

      // 重要按鈕補綁，存在才綁，不存在就略過
      const addOrderBtn = document.getElementById("addManualOrderBtn")
        || [...document.querySelectorAll("button")].find(btn => (btn.textContent || "").includes("新增叫貨紀錄"));
      if(addOrderBtn && typeof addManualOrder === "function"){
        addOrderBtn.onclick = event => {
          event.preventDefault();
          addManualOrder();
        };
      }

      const addItemBtn = document.getElementById("addItemManageBtn");
      if(addItemBtn && typeof addNewItemFromManage === "function"){
        addItemBtn.onclick = event => {
          event.preventDefault();
          addNewItemFromManage();
        };
      }

      const exportBtn = document.getElementById("exportExcelBtn");
      if(exportBtn && typeof exportExcel === "function"){
        exportBtn.onclick = event => {
          event.preventDefault();
          exportExcel();
        };
      }

      const clearHistoryBtn = document.getElementById("clearHistoryBtn");
      if(clearHistoryBtn && typeof clearHistoryRecords === "function"){
        clearHistoryBtn.onclick = event => {
          event.preventDefault();
          clearHistoryRecords();
        };
      }
    };
    window.bindEvents = bindEvents;
  }

  // 避免 renderIncoming / renderHistoryPage 因 escapeHtml 問題再中斷
  const oldRenderAllV305 = renderAll;
  renderAll = function(){
    try{
      oldRenderAllV305();
    }catch(error){
      console.error("renderAll runtime error:", error);
      const sync = document.getElementById("syncStatusText");
      if(sync && sync.textContent !== "已同步"){
        sync.textContent = "頁面渲染異常";
        sync.classList.remove("ok","warn");
        sync.classList.add("bad");
      }
    }
  };

  document.addEventListener("DOMContentLoaded",()=>{
    try{
      if(typeof bindEvents === "function") bindEvents();
    }catch(error){
      console.warn("bindEvents DOMContentLoaded fallback:", error);
    }
  });

  window.gbRuntimeCheck = function(){
    return {
      hasEscapeHtml: typeof escapeHtml === "function",
      hasBindEvents: typeof bindEvents === "function",
      hasRenderAll: typeof renderAll === "function",
      syncText: document.getElementById("syncStatusText")?.textContent,
      incomingRows: document.querySelectorAll("#incomingTable tr").length,
      historyRows: document.querySelectorAll("#historyPageList .history-row").length,
      lastSyncError: window.lastSyncError || null
    };
  };
})();

/* GoldenBird Inventory v3.0.6｜分頁聯動與同步穩定修正 */
(function(){
  window.GB_VERSION = "goldenbird-inventory-v3.0.6-stability-fix";

  function gbSetSyncStatus(text, type){
    const el = document.getElementById("syncStatusText");
    if(!el) return;
    el.textContent = text;
    el.classList.remove("ok","warn","bad");
    if(type) el.classList.add(type);
  }

  function gbEnsureDataShape(){
    if(typeof data === "undefined") return;
    data.items = Array.isArray(data.items) ? data.items : [];
    data.orders = Array.isArray(data.orders) ? data.orders : [];
    data.history = Array.isArray(data.history) ? data.history : [];
    data.mappings = Array.isArray(data.mappings) ? data.mappings : [];
  }

  function gbSafeCall(name){
    try{
      const fn = window[name] || (typeof globalThis !== "undefined" ? globalThis[name] : null);
      if(typeof fn === "function") fn();
    }catch(error){
      console.warn(`${name} failed`, error);
    }
  }

  function gbRenderLinkedViews(){
    gbEnsureDataShape();

    // 各分頁資料聯動：只呼叫存在的渲染函式，避免某個區塊錯誤讓全部中斷
    [
      "renderInventory",
      "renderIncoming",
      "renderAdmin",
      "renderAdminOrders",
      "renderCostReport",
      "renderItemManageTable",
      "renderHistoryPage",
      "renderStockHistory",
      "ensureExcelExportButton",
      "setManualOrderDefaultDate"
    ].forEach(gbSafeCall);

    gbRefreshCategoryFiltersV306();
    gbBindImportantButtonsV306();
    gbFixMobileV306();
  }

  function gbRefreshCategoryFiltersV306(){
    if(typeof data === "undefined" || !Array.isArray(data.items)) return;

    const categories = [...new Set(data.items.map(item => String(item.category || "").trim()).filter(Boolean))].sort();

    function fillSelect(id, includeAll){
      const select = document.getElementById(id);
      if(!select) return;

      const current = select.value;
      select.innerHTML = (includeAll ? '<option value="all">全部分類</option>' : '') +
        categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");

      if([...select.options].some(option => option.value === current)){
        select.value = current;
      }else if(includeAll){
        select.value = "all";
      }
    }

    fillSelect("categoryFilter", true);
    fillSelect("itemManageCategoryFilter", true);
    fillSelect("newItemCategoryManage", false);
  }

  function gbBindImportantButtonsV306(){
    const addOrderBtn = document.getElementById("addManualOrderBtn")
      || [...document.querySelectorAll("button")].find(btn => (btn.textContent || "").includes("新增叫貨紀錄"));
    if(addOrderBtn && typeof addManualOrder === "function"){
      addOrderBtn.onclick = event => {
        event.preventDefault();
        addManualOrder();
      };
    }

    const addItemBtn = document.getElementById("addItemManageBtn");
    if(addItemBtn && typeof addNewItemFromManage === "function"){
      addItemBtn.onclick = event => {
        event.preventDefault();
        addNewItemFromManage();
      };
    }

    const exportBtn = document.getElementById("exportExcelBtn");
    if(exportBtn && typeof exportExcel === "function"){
      exportBtn.onclick = event => {
        event.preventDefault();
        exportExcel();
      };
    }

    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    if(clearHistoryBtn && typeof clearHistoryRecords === "function"){
      clearHistoryBtn.onclick = event => {
        event.preventDefault();
        clearHistoryRecords();
      };
    }

    document.querySelectorAll(".receive-btn").forEach(btn=>{
      btn.onclick = () => {
        if(typeof receiveOrder === "function") receiveOrder(btn.dataset.id);
      };
    });
  }

  function gbFixMobileV306(){
    if(document.getElementById("gbV306MobileCss")) return;

    const style = document.createElement("style");
    style.id = "gbV306MobileCss";
    style.textContent = `
      @media(max-width:760px){
        header, header .header-inner{
          position:relative !important;
          top:auto !important;
          z-index:auto !important;
        }

        main .tabs{
          display:grid !important;
          grid-template-columns:1fr 1fr !important;
          gap:8px !important;
          padding:8px 12px !important;
        }

        main .tabs .tab{
          width:100% !important;
          min-width:0 !important;
          white-space:nowrap !important;
          font-size:15px !important;
          padding:10px 8px !important;
        }

        body.gb-mobile-scrolled main .tabs{
          position:sticky !important;
          top:0 !important;
          z-index:100 !important;
          background:rgba(248,247,243,.96) !important;
          backdrop-filter:blur(8px) !important;
          border-bottom:1px solid var(--line) !important;
          box-shadow:0 6px 16px rgba(0,0,0,.05);
        }

        body.gb-mobile-scrolled main .tabs .tab[data-tab="history"],
        body.gb-mobile-scrolled main .tabs .tab[data-tab="admin"]{
          display:none !important;
        }

        .admin-sub-tabs{
          grid-template-columns:1fr !important;
          position:relative !important;
          top:auto !important;
        }

        #incoming .table-scroll{
          overflow-x:auto !important;
          -webkit-overflow-scrolling:touch;
        }

        #incoming table{
          min-width:820px;
        }

        .role-box:not(.mobile-open){
          display:none !important;
        }
      }
    `;
    document.head.appendChild(style);

    if(!window.__gbV306MobileScrollBound){
      window.__gbV306MobileScrollBound = true;
      window.addEventListener("scroll", () => {
        if(window.innerWidth <= 760){
          document.body.classList.toggle("gb-mobile-scrolled", window.scrollY > 120);
        }else{
          document.body.classList.remove("gb-mobile-scrolled");
        }
      }, {passive:true});
    }
  }

  function gbApplySnapshotV306(snapshot){
    try{
      if(!snapshot.exists){
        return false;
      }

      const raw = snapshot.data();
      const remote = typeof normalizeRemoteData === "function" ? normalizeRemoteData(raw) : (raw?.payload || raw);

      if(!remote){
        window.lastSyncError = {
          stage:"applySnapshot",
          code:"empty-data",
          message:"Firestore 文件存在，但資料格式為空。",
          time:new Date().toISOString()
        };
        gbSetSyncStatus("同步失敗：資料格式", "bad");
        return false;
      }

      gbIsApplyingRemote = true;
      data = remote;
      gbEnsureDataShape();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      gbRemoteReady = true;
      gbIsApplyingRemote = false;

      gbSetSyncStatus("已同步", "ok");
      gbRenderLinkedViews();
      return true;
    }catch(error){
      gbIsApplyingRemote = false;
      window.lastSyncError = {
        stage:"applySnapshot",
        code:error?.code || "",
        message:error?.message || String(error),
        time:new Date().toISOString()
      };
      console.error("GB apply snapshot failed:", window.lastSyncError, error);
      gbSetSyncStatus("同步失敗：畫面渲染", "bad");
      return false;
    }
  }

  function gbStartRemoteSyncV306(){
    try{
      if(typeof getMainDocRef !== "function"){
        window.lastSyncError = {stage:"getMainDocRef", code:"missing-function", message:"getMainDocRef 不存在", time:new Date().toISOString()};
        gbSetSyncStatus("同步未啟動", "bad");
        return;
      }

      const ref = getMainDocRef();
      if(!ref){
        window.lastSyncError = {stage:"getMainDocRef", code:"no-ref", message:"無法取得 Firestore 文件路徑", time:new Date().toISOString()};
        gbSetSyncStatus("同步未啟動", "bad");
        return;
      }

      if(typeof gbUnsubscribeMainDoc !== "undefined" && gbUnsubscribeMainDoc){
        try{ gbUnsubscribeMainDoc(); }catch(error){ console.warn(error); }
      }

      window.lastSyncError = null;
      gbSetSyncStatus("同步連線中…", "warn");

      ref.get()
        .then(snapshot => {
          if(snapshot.exists){
            gbApplySnapshotV306(snapshot);
            return null;
          }

          return ref.set({
            payload: data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: window.GB_AUTH?.user?.email || "unknown",
            version: window.GB_VERSION || "v3.0.6"
          }, { merge:true }).then(()=>{
            gbRemoteReady = true;
            gbSetSyncStatus("已同步", "ok");
            gbRenderLinkedViews();
          });
        })
        .then(()=>{
          gbUnsubscribeMainDoc = ref.onSnapshot(snapshot=>{
            if(snapshot.exists) gbApplySnapshotV306(snapshot);
          }, error=>{
            window.lastSyncError = {
              stage:"onSnapshot",
              code:error?.code || "",
              message:error?.message || String(error),
              time:new Date().toISOString()
            };
            console.error("GB onSnapshot failed:", window.lastSyncError, error);
            gbSetSyncStatus(error?.code === "permission-denied" ? "同步失敗：權限不足" : "同步失敗", "bad");
          });
        })
        .catch(error=>{
          window.lastSyncError = {
            stage:"initial get/set",
            code:error?.code || "",
            message:error?.message || String(error),
            time:new Date().toISOString()
          };
          console.error("GB initial sync failed:", window.lastSyncError, error);
          gbSetSyncStatus(error?.code === "permission-denied" ? "同步失敗：權限不足" : "同步失敗", "bad");
        });
    }catch(error){
      window.lastSyncError = {
        stage:"startRemoteSync",
        code:error?.code || "",
        message:error?.message || String(error),
        time:new Date().toISOString()
      };
      console.error("GB start sync fatal:", window.lastSyncError, error);
      gbSetSyncStatus("同步失敗", "bad");
    }
  }

  window.startRemoteSync = gbStartRemoteSyncV306;
  startRemoteSync = gbStartRemoteSyncV306;

  window.gbSyncDebugText = function(){
    return JSON.stringify({
      version: window.GB_VERSION,
      syncText: document.getElementById("syncStatusText")?.textContent,
      firebaseReady: !!window.GB_FIREBASE?.ready,
      authReady: !!window.GB_AUTH?.ready,
      user: window.GB_AUTH?.user || null,
      role: window.GB_AUTH?.role || null,
      hasDb: !!window.GB_FIREBASE?.db,
      hasStartRemoteSync: typeof startRemoteSync,
      itemCount: Array.isArray(data?.items) ? data.items.length : null,
      orderCount: Array.isArray(data?.orders) ? data.orders.length : null,
      historyCount: Array.isArray(data?.history) ? data.history.length : null,
      lastSyncError: window.lastSyncError || null
    }, null, 2);
  };

  window.gbLinkageCheck = function(){
    return {
      version: window.GB_VERSION,
      syncText: document.getElementById("syncStatusText")?.textContent,
      items: data?.items?.length || 0,
      orders: data?.orders?.length || 0,
      history: data?.history?.length || 0,
      inventoryRows: document.querySelectorAll("#inventoryGrid .inventory-row, #inventoryGrid .inventory-card").length,
      incomingRows: document.querySelectorAll("#incomingTable tr").length,
      adminOrderRows: document.querySelectorAll("#adminOrdersTable tr").length,
      itemManageRows: document.querySelectorAll("#itemManageTable tr").length,
      historyRows: document.querySelectorAll("#historyPageList .history-row").length,
      mobile: window.innerWidth <= 760,
      lastSyncError: window.lastSyncError || null
    };
  };

  const oldRenderAllV306 = renderAll;
  renderAll = function(){
    try{
      oldRenderAllV306();
    }catch(error){
      console.warn("old renderAll failed, fallback render linked views:", error);
    }
    gbRenderLinkedViews();
  };

  document.addEventListener("DOMContentLoaded",()=>{
    gbEnsureDataShape();
    gbBindImportantButtonsV306();
    gbFixMobileV306();

    setTimeout(()=>{
      gbRenderLinkedViews();
      if(window.GB_FIREBASE?.ready && window.GB_AUTH?.ready && window.GB_AUTH?.user){
        gbStartRemoteSyncV306();
      }
    }, 1200);
  });

  window.addEventListener("gb-role-ready", ()=>{
    setTimeout(()=>{
      gbRenderLinkedViews();
      gbStartRemoteSyncV306();
    }, 300);
  });
})();

/* GoldenBird Inventory v3.0.7｜介面細節微調 */
(function(){
  function applyV307UiPolish(){
    if(document.getElementById("gbV307UiCss")) return;

    const style = document.createElement("style");
    style.id = "gbV307UiCss";
    style.textContent = `
      /* 1. 選取中的標籤文字可讀性 */
      .tab.active,
      .admin-sub-tab.active{
        background:var(--main) !important;
        color:#ffffff !important;
        font-weight:900 !important;
        text-shadow:0 1px 1px rgba(0,0,0,.18);
      }

      .tab.active *,
      .admin-sub-tab.active *{
        color:#ffffff !important;
      }

      /* 3. 最近新增 / 最近更新提示改淡，不像警示 */
      .highlight-row,
      .inventory-row.highlight-row,
      .inventory-card.highlight-row{
        border-left:4px solid #ead9a8 !important;
        box-shadow:inset 4px 0 0 #ead9a8, 0 2px 10px rgba(0,0,0,.03) !important;
      }

      /* 2. 手機版在途商品改卡片式，避免底部出現很寬的橫向捲軸 */
      @media(max-width:760px){
        #incoming .table-scroll{
          overflow-x:visible !important;
        }

        #incoming table{
          min-width:0 !important;
          width:100% !important;
          border-collapse:separate !important;
          border-spacing:0 12px !important;
        }

        #incoming table thead{
          display:none !important;
        }

        #incomingTable tr{
          display:block !important;
          background:#fff !important;
          border:1px solid var(--line) !important;
          border-radius:18px !important;
          padding:12px !important;
          box-shadow:0 4px 14px rgba(0,0,0,.04);
          margin-bottom:12px !important;
        }

        #incomingTable td{
          display:grid !important;
          grid-template-columns:88px 1fr !important;
          gap:8px !important;
          padding:7px 0 !important;
          border:0 !important;
          white-space:normal !important;
          align-items:center !important;
        }

        #incomingTable td::before{
          color:var(--muted);
          font-weight:800;
          font-size:13px;
        }

        #incomingTable td:nth-child(1)::before{ content:"叫貨日期"; }
        #incomingTable td:nth-child(2)::before{ content:"品項"; }
        #incomingTable td:nth-child(3)::before{ content:"叫貨數量"; }
        #incomingTable td:nth-child(4)::before{ content:"已到貨"; }
        #incomingTable td:nth-child(5)::before{ content:"剩餘在途"; }
        #incomingTable td:nth-child(6)::before{ content:"叫貨人"; }
        #incomingTable td:nth-child(7)::before{ content:"狀態"; }
        #incomingTable td:nth-child(8)::before{ content:"本次到貨"; }
        #incomingTable td:nth-child(9)::before{ content:"操作"; }

        #incomingTable .receive-input{
          width:100% !important;
          min-width:0 !important;
        }

        #incomingTable .receive-btn{
          width:100% !important;
          min-width:0 !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", applyV307UiPolish);

  const oldRenderAllV307 = renderAll;
  renderAll = function(){
    oldRenderAllV307();
    applyV307UiPolish();
  };

  window.gbUiPolishCheck = function(){
    return {
      version: window.GB_VERSION,
      hasV307Css: !!document.getElementById("gbV307UiCss"),
      mobile: window.innerWidth <= 760,
      incomingRows: document.querySelectorAll("#incomingTable tr").length,
      activeTabs: [...document.querySelectorAll(".tab.active,.admin-sub-tab.active")].map(el => el.textContent.trim())
    };
  };
})();

/* GoldenBird Inventory v3.0.8｜手機 UI 微調 */
(function(){
  function applyV308MobileUiFix(){
    if(document.getElementById("gbV308MobileUiCss")) return;

    const style = document.createElement("style");
    style.id = "gbV308MobileUiCss";
    style.textContent = `
      /* 3. 標籤選取狀態：改淡底深字，避免白字不明顯 */
      .tab.active,
      .admin-sub-tab.active{
        background:#e8f3f4 !important;
        color:var(--main) !important;
        border-color:#b9d5d9 !important;
        font-weight:900 !important;
        text-shadow:none !important;
        box-shadow:inset 0 0 0 2px rgba(62,96,102,.10) !important;
      }

      .tab.active *,
      .admin-sub-tab.active *{
        color:var(--main) !important;
      }

      /* 2. 浮動按鈕內容置中 */
      #gbFloatActions button,
      #gbHomeBtn,
      #gbTopBtn{
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        line-height:1 !important;
        padding:0 !important;
        text-align:center !important;
      }

      #gbHomeBtn{
        font-size:20px !important;
      }

      #gbTopBtn{
        font-size:17px !important;
      }

      /* 1. 日期欄位避免突出 */
      input[type="date"],
      #manualOrderDate{
        width:100% !important;
        max-width:100% !important;
        min-width:0 !important;
        box-sizing:border-box !important;
      }

      @media(max-width:760px){
        .field,
        .form-grid > *,
        .manual-order-grid > *,
        .order-form > *{
          min-width:0 !important;
          max-width:100% !important;
          box-sizing:border-box !important;
        }

        input,
        select,
        textarea,
        button{
          max-width:100% !important;
          box-sizing:border-box !important;
        }

        #manualOrderDate{
          display:block !important;
          width:100% !important;
          min-width:0 !important;
        }

        /* 手機版在途商品：精簡列，接近庫存總覽，不做大卡片 */
        #incoming .table-scroll{
          overflow-x:visible !important;
        }

        #incoming table{
          width:100% !important;
          min-width:0 !important;
          border-collapse:separate !important;
          border-spacing:0 8px !important;
        }

        #incoming table thead{
          display:none !important;
        }

        #incomingTable tr{
          display:grid !important;
          grid-template-columns:1fr auto;
          grid-template-areas:
            "name status"
            "meta meta"
            "action action";
          gap:8px 10px !important;
          background:#fff !important;
          border:1px solid var(--line) !important;
          border-radius:16px !important;
          padding:10px 12px !important;
          margin-bottom:8px !important;
          box-shadow:0 3px 10px rgba(0,0,0,.035) !important;
        }

        #incomingTable td{
          display:block !important;
          padding:0 !important;
          border:0 !important;
          white-space:normal !important;
          min-width:0 !important;
        }

        #incomingTable td::before{
          content:none !important;
        }

        /* 欄位順序：日期、品項、叫貨數、已到貨、剩餘、叫貨人、狀態、本次到貨、操作 */
        #incomingTable td:nth-child(1){
          display:none !important;
        }

        #incomingTable td:nth-child(2){
          grid-area:name;
          font-weight:900 !important;
          color:var(--text);
          font-size:16px;
          line-height:1.35;
        }

        #incomingTable td:nth-child(7){
          grid-area:status;
          justify-self:end;
          align-self:start;
        }

        #incomingTable td:nth-child(3),
        #incomingTable td:nth-child(4),
        #incomingTable td:nth-child(5),
        #incomingTable td:nth-child(6){
          grid-area:meta;
          display:inline-flex !important;
          align-items:center;
          color:var(--muted);
          font-size:13px;
          font-weight:800;
        }

        #incomingTable td:nth-child(3)::before{ content:"叫 "; color:var(--muted); }
        #incomingTable td:nth-child(4)::before{ content:"已到 "; color:var(--muted); }
        #incomingTable td:nth-child(5)::before{ content:"剩 "; color:var(--muted); }
        #incomingTable td:nth-child(6)::before{ content:"人 "; color:var(--muted); }

        #incomingTable td:nth-child(3){
          margin-top:26px;
        }

        #incomingTable td:nth-child(4){
          margin-top:26px;
          margin-left:58px;
        }

        #incomingTable td:nth-child(5){
          margin-top:26px;
          margin-left:122px;
        }

        #incomingTable td:nth-child(6){
          margin-top:26px;
          margin-left:188px;
        }

        #incomingTable td:nth-child(8),
        #incomingTable td:nth-child(9){
          grid-area:action;
          margin-top:30px;
        }

        #incomingTable td:nth-child(8){
          width:48%;
        }

        #incomingTable td:nth-child(9){
          width:48%;
          justify-self:end;
          margin-left:auto;
        }

        #incomingTable .receive-input{
          width:100% !important;
          height:42px !important;
          min-width:0 !important;
          border-radius:14px !important;
        }

        #incomingTable .receive-btn{
          width:100% !important;
          height:42px !important;
          min-width:0 !important;
          border-radius:14px !important;
          white-space:nowrap !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", applyV308MobileUiFix);

  const oldRenderAllV308 = renderAll;
  renderAll = function(){
    oldRenderAllV308();
    applyV308MobileUiFix();
  };

  window.gbMobileUiCheck = function(){
    return {
      version: window.GB_VERSION,
      hasV308Css: !!document.getElementById("gbV308MobileUiCss"),
      mobile: window.innerWidth <= 760,
      activeTabs: [...document.querySelectorAll(".tab.active,.admin-sub-tab.active")].map(el => el.textContent.trim()),
      incomingRows: document.querySelectorAll("#incomingTable tr").length
    };
  };
})();

/* GoldenBird Inventory v3.0.9｜品項排序與手機在途商品優化 */
(function(){
  function getItemCreatedTime(item){
    const value = item.createdAt || item.updatedAt || item.lastUpdatedAt || 0;
    if(typeof value === "number") return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function sortItemsNewestFirst(){
    if(typeof data === "undefined" || !Array.isArray(data.items)) return;
    data.items.sort((a,b)=>{
      const bt = getItemCreatedTime(b);
      const at = getItemCreatedTime(a);
      if(bt !== at) return bt - at;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }

  const oldCreateNewItemV309 = typeof createNewItem === "function" ? createNewItem : null;
  if(oldCreateNewItemV309){
    createNewItem = function(args){
      oldCreateNewItemV309(args);

      const newest = data.items && data.items[0];
      const now = Date.now();

      // 若原本新增品項沒有 createdAt，補在最新一筆新增品項上
      const candidates = (data.items || []).filter(item => !item.createdAt);
      const created = candidates[candidates.length - 1];
      if(created){
        created.createdAt = now;
        created.updatedAt = now;
      }

      sortItemsNewestFirst();
      saveData();
      renderAll();
    };
    window.createNewItem = createNewItem;
  }

  function renderItemManageNewestFirst(){
    if(typeof renderItemManageTable !== "function") return;
    sortItemsNewestFirst();
    renderItemManageTable();
  }

  function applyV309Ui(){
    if(document.getElementById("gbV309UiCss")) return;

    const style = document.createElement("style");
    style.id = "gbV309UiCss";
    style.textContent = `
      @media(max-width:760px){
        /* 手機版在途商品：改為清楚的小型資訊列 */
        #incomingTable tr{
          display:grid !important;
          grid-template-columns:1fr auto !important;
          grid-template-areas:
            "title status"
            "stats stats"
            "action action" !important;
          gap:8px 10px !important;
          padding:12px 14px !important;
          border-radius:18px !important;
          background:#fff !important;
          border:1px solid var(--line) !important;
          box-shadow:0 3px 10px rgba(0,0,0,.035) !important;
          margin-bottom:10px !important;
        }

        #incomingTable td{
          display:block !important;
          border:0 !important;
          padding:0 !important;
          min-width:0 !important;
          white-space:normal !important;
        }

        #incomingTable td:nth-child(1){
          display:none !important;
        }

        #incomingTable td:nth-child(2){
          grid-area:title !important;
          font-size:17px !important;
          font-weight:900 !important;
          color:var(--text) !important;
          line-height:1.35 !important;
        }

        #incomingTable td:nth-child(7){
          grid-area:status !important;
          justify-self:end !important;
          align-self:start !important;
        }

        #incomingTable td:nth-child(3),
        #incomingTable td:nth-child(4),
        #incomingTable td:nth-child(5),
        #incomingTable td:nth-child(6){
          grid-area:stats !important;
          display:inline-flex !important;
          align-items:center !important;
          justify-content:flex-start !important;
          width:auto !important;
          margin:0 !important;
          color:var(--muted) !important;
          font-size:13px !important;
          font-weight:800 !important;
        }

        #incomingTable td:nth-child(3)::before{ content:"叫貨 "; color:var(--main); }
        #incomingTable td:nth-child(4)::before{ content:"已到 "; color:var(--main); }
        #incomingTable td:nth-child(5)::before{ content:"剩餘 "; color:var(--main); }
        #incomingTable td:nth-child(6)::before{ content:"人員 "; color:var(--main); }

        #incomingTable td:nth-child(3){ padding-top:2px !important; }
        #incomingTable td:nth-child(4){ margin-left:82px !important; }
        #incomingTable td:nth-child(5){ margin-left:162px !important; }
        #incomingTable td:nth-child(6){ margin-left:248px !important; }

        #incomingTable td:nth-child(8),
        #incomingTable td:nth-child(9){
          grid-area:action !important;
          margin-top:8px !important;
        }

        #incomingTable td:nth-child(8){
          width:46% !important;
        }

        #incomingTable td:nth-child(9){
          width:50% !important;
          justify-self:end !important;
          margin-left:auto !important;
        }

        #incomingTable .receive-input,
        #incomingTable .receive-btn{
          height:42px !important;
          border-radius:14px !important;
          font-size:15px !important;
        }

        #incomingTable .receive-input{
          width:100% !important;
        }

        #incomingTable .receive-btn{
          width:100% !important;
          white-space:nowrap !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const oldRenderAllV309 = renderAll;
  renderAll = function(){
    sortItemsNewestFirst();
    oldRenderAllV309();
    applyV309Ui();

    // 後台品項管理進入時，再保險刷新一次
    if(currentTab === "admin"){
      setTimeout(renderItemManageNewestFirst, 50);
    }
  };

  document.addEventListener("DOMContentLoaded",()=>{
    sortItemsNewestFirst();
    applyV309Ui();
    setTimeout(renderItemManageNewestFirst, 500);
  });

  window.gbItemOrderCheck = function(){
    return {
      version: window.GB_VERSION,
      firstItems: (data.items || []).slice(0,5).map(item => ({
        name:item.name,
        createdAt:item.createdAt || "",
        updatedAt:item.updatedAt || item.lastUpdatedAt || ""
      })),
      incomingRows: document.querySelectorAll("#incomingTable tr").length,
      hasV309Css: !!document.getElementById("gbV309UiCss")
    };
  };
})();

/* GoldenBird Inventory v3.1.0｜手機版在途商品 UI 優化 */
(function(){
  function applyV310IncomingMobileUi(){
    if(document.getElementById("gbV310IncomingMobileCss")) return;

    const style = document.createElement("style");
    style.id = "gbV310IncomingMobileCss";
    style.textContent = `
      @media(max-width:760px){
        #incoming .table-scroll{
          overflow-x:visible !important;
          width:100% !important;
          max-width:100% !important;
        }

        #incoming table{
          width:100% !important;
          min-width:0 !important;
          border-collapse:separate !important;
          border-spacing:0 10px !important;
        }

        #incoming table thead{
          display:none !important;
        }

        #incomingTable{
          width:100% !important;
          max-width:100% !important;
        }

        #incomingTable tr{
          display:grid !important;
          grid-template-columns:1fr auto !important;
          grid-template-areas:
            "title status"
            "stats stats"
            "person person"
            "action action" !important;
          gap:8px 10px !important;
          width:100% !important;
          max-width:100% !important;
          box-sizing:border-box !important;
          padding:12px 12px !important;
          margin:0 0 10px !important;
          border:1px solid var(--line) !important;
          border-radius:18px !important;
          background:#fff !important;
          box-shadow:0 3px 10px rgba(0,0,0,.035) !important;
        }

        #incomingTable td{
          display:block !important;
          border:0 !important;
          padding:0 !important;
          margin:0 !important;
          min-width:0 !important;
          max-width:100% !important;
          white-space:normal !important;
          box-sizing:border-box !important;
        }

        #incomingTable td::before{
          content:none !important;
        }

        /* 日期先隱藏，避免卡片過高；仍保留資料，不影響桌機 */
        #incomingTable td:nth-child(1){
          display:none !important;
        }

        /* 品項 */
        #incomingTable td:nth-child(2){
          grid-area:title !important;
          font-size:17px !important;
          font-weight:900 !important;
          line-height:1.35 !important;
          color:var(--text) !important;
          overflow:hidden !important;
          display:-webkit-box !important;
          -webkit-line-clamp:2 !important;
          -webkit-box-orient:vertical !important;
        }

        /* 狀態 */
        #incomingTable td:nth-child(7){
          grid-area:status !important;
          justify-self:end !important;
          align-self:start !important;
        }

        #incomingTable td:nth-child(7) .badge{
          padding:6px 10px !important;
          border-radius:999px !important;
          font-size:13px !important;
          font-weight:900 !important;
          white-space:nowrap !important;
        }

        /* 數據列：叫貨 / 已到 / 剩餘 */
        #incomingTable td:nth-child(3),
        #incomingTable td:nth-child(4),
        #incomingTable td:nth-child(5){
          grid-area:stats !important;
          display:inline-flex !important;
          flex-direction:column !important;
          align-items:flex-start !important;
          justify-content:center !important;
          width:32% !important;
          color:var(--text) !important;
          font-size:18px !important;
          font-weight:900 !important;
          line-height:1.2 !important;
          padding-top:2px !important;
        }

        #incomingTable td:nth-child(3)::before,
        #incomingTable td:nth-child(4)::before,
        #incomingTable td:nth-child(5)::before{
          display:block !important;
          color:var(--muted) !important;
          font-size:12px !important;
          font-weight:800 !important;
          margin-bottom:3px !important;
        }

        #incomingTable td:nth-child(3)::before{ content:"叫貨" !important; }
        #incomingTable td:nth-child(4)::before{ content:"已到" !important; }
        #incomingTable td:nth-child(5)::before{ content:"剩餘" !important; }

        #incomingTable td:nth-child(3){
          justify-self:start !important;
        }

        #incomingTable td:nth-child(4){
          justify-self:center !important;
          margin-left:34% !important;
        }

        #incomingTable td:nth-child(5){
          justify-self:end !important;
          margin-left:68% !important;
        }

        /* 叫貨人 */
        #incomingTable td:nth-child(6){
          grid-area:person !important;
          color:var(--muted) !important;
          font-size:13px !important;
          font-weight:800 !important;
          padding-top:2px !important;
        }

        #incomingTable td:nth-child(6)::before{
          content:"叫貨人：" !important;
          color:var(--muted) !important;
          font-weight:800 !important;
        }

        /* 操作列 */
        #incomingTable td:nth-child(8),
        #incomingTable td:nth-child(9){
          grid-area:action !important;
          margin-top:4px !important;
        }

        #incomingTable td:nth-child(8){
          width:42% !important;
          justify-self:start !important;
        }

        #incomingTable td:nth-child(9){
          width:55% !important;
          justify-self:end !important;
          margin-left:auto !important;
        }

        #incomingTable .receive-input{
          width:100% !important;
          height:44px !important;
          min-width:0 !important;
          border-radius:15px !important;
          font-size:15px !important;
          padding:0 12px !important;
          text-align:center !important;
        }

        #incomingTable .receive-btn{
          width:100% !important;
          height:44px !important;
          min-width:0 !important;
          border-radius:15px !important;
          font-size:15px !important;
          font-weight:900 !important;
          white-space:nowrap !important;
          padding:0 10px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", applyV310IncomingMobileUi);

  const oldRenderAllV310 = renderAll;
  renderAll = function(){
    oldRenderAllV310();
    applyV310IncomingMobileUi();
  };

  window.gbIncomingMobileUiCheck = function(){
    return {
      version: window.GB_VERSION,
      hasV310Css: !!document.getElementById("gbV310IncomingMobileCss"),
      mobile: window.innerWidth <= 760,
      incomingRows: document.querySelectorAll("#incomingTable tr").length
    };
  };
})();

/* GoldenBird Inventory v3.1.1｜手機版在途商品改為庫存總覽風格 */
(function(){
  function applyV311IncomingLikeInventory(){
    if(document.getElementById("gbV311IncomingLikeInventoryCss")) return;

    const style = document.createElement("style");
    style.id = "gbV311IncomingLikeInventoryCss";
    style.textContent = `
      /* 後台內部分頁與主頁籤避免文字換行 */
      .tab,
      .admin-sub-tab{
        white-space:nowrap !important;
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        gap:6px !important;
      }

      @media(max-width:760px){
        #incoming .table-scroll{
          overflow-x:visible !important;
          width:100% !important;
          max-width:100% !important;
        }

        #incoming table{
          width:100% !important;
          min-width:0 !important;
          border-collapse:separate !important;
          border-spacing:0 8px !important;
        }

        #incoming table thead{
          display:none !important;
        }

        #incomingTable{
          width:100% !important;
          max-width:100% !important;
        }

        #incomingTable tr{
          display:grid !important;
          grid-template-columns:1fr auto !important;
          grid-template-areas:
            "title status"
            "stats stats"
            "person person"
            "action action" !important;
          gap:8px 10px !important;
          width:100% !important;
          max-width:100% !important;
          box-sizing:border-box !important;
          padding:12px 14px !important;
          margin:0 0 8px !important;
          border:1px solid var(--line) !important;
          border-radius:18px !important;
          background:#fff !important;
          box-shadow:0 3px 10px rgba(0,0,0,.035) !important;
        }

        #incomingTable td{
          display:block !important;
          border:0 !important;
          padding:0 !important;
          margin:0 !important;
          min-width:0 !important;
          max-width:100% !important;
          white-space:normal !important;
          box-sizing:border-box !important;
        }

        #incomingTable td::before{
          content:none !important;
        }

        #incomingTable td:nth-child(1){
          display:none !important;
        }

        /* 品項名稱：對齊庫存總覽大小與重量 */
        #incomingTable td:nth-child(2){
          grid-area:title !important;
          font-size:17px !important;
          font-weight:900 !important;
          line-height:1.35 !important;
          color:var(--text) !important;
          overflow:hidden !important;
          display:-webkit-box !important;
          -webkit-line-clamp:2 !important;
          -webkit-box-orient:vertical !important;
        }

        /* 狀態標籤：庫存總覽風格 */
        #incomingTable td:nth-child(7){
          grid-area:status !important;
          justify-self:end !important;
          align-self:start !important;
        }

        #incomingTable td:nth-child(7) .badge{
          display:inline-flex !important;
          align-items:center !important;
          justify-content:center !important;
          padding:6px 11px !important;
          border-radius:999px !important;
          font-size:13px !important;
          font-weight:900 !important;
          white-space:nowrap !important;
        }

        /* 數字資訊：像庫存總覽一樣，有標籤、有數字 */
        #incomingTable td:nth-child(3),
        #incomingTable td:nth-child(4),
        #incomingTable td:nth-child(5){
          grid-area:stats !important;
          display:inline-flex !important;
          flex-direction:column !important;
          align-items:flex-start !important;
          justify-content:center !important;
          width:32% !important;
          color:var(--text) !important;
          font-size:17px !important;
          font-weight:900 !important;
          line-height:1.25 !important;
          padding-top:2px !important;
        }

        #incomingTable td:nth-child(3)::before,
        #incomingTable td:nth-child(4)::before,
        #incomingTable td:nth-child(5)::before{
          display:inline-flex !important;
          align-items:center !important;
          width:max-content !important;
          padding:3px 7px !important;
          margin-bottom:4px !important;
          border-radius:999px !important;
          background:#f3f5f1 !important;
          color:var(--muted) !important;
          font-size:12px !important;
          font-weight:900 !important;
        }

        #incomingTable td:nth-child(3)::before{ content:"叫貨" !important; }
        #incomingTable td:nth-child(4)::before{ content:"已到" !important; }
        #incomingTable td:nth-child(5)::before{ content:"剩餘" !important; }

        #incomingTable td:nth-child(3){
          justify-self:start !important;
        }

        #incomingTable td:nth-child(4){
          justify-self:center !important;
          margin-left:34% !important;
        }

        #incomingTable td:nth-child(5){
          justify-self:end !important;
          margin-left:68% !important;
        }

        /* 叫貨人用小標籤，不佔高度 */
        #incomingTable td:nth-child(6){
          grid-area:person !important;
          display:inline-flex !important;
          align-items:center !important;
          width:max-content !important;
          max-width:100% !important;
          padding:4px 9px !important;
          border-radius:999px !important;
          background:#f3f5f1 !important;
          color:var(--muted) !important;
          font-size:12px !important;
          font-weight:900 !important;
        }

        #incomingTable td:nth-child(6)::before{
          content:"叫貨人 " !important;
          color:var(--muted) !important;
          font-weight:900 !important;
          margin-right:2px !important;
        }

        /* 操作列：同列、好按、不撐寬 */
        #incomingTable td:nth-child(8),
        #incomingTable td:nth-child(9){
          grid-area:action !important;
          margin-top:2px !important;
        }

        #incomingTable td:nth-child(8){
          width:42% !important;
          justify-self:start !important;
        }

        #incomingTable td:nth-child(9){
          width:55% !important;
          justify-self:end !important;
          margin-left:auto !important;
        }

        #incomingTable .receive-input{
          width:100% !important;
          height:42px !important;
          min-width:0 !important;
          border-radius:15px !important;
          font-size:15px !important;
          padding:0 12px !important;
          text-align:center !important;
        }

        #incomingTable .receive-btn{
          width:100% !important;
          height:42px !important;
          min-width:0 !important;
          border-radius:15px !important;
          font-size:15px !important;
          font-weight:900 !important;
          white-space:nowrap !important;
          padding:0 10px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", applyV311IncomingLikeInventory);

  const oldRenderAllV311 = renderAll;
  renderAll = function(){
    oldRenderAllV311();
    applyV311IncomingLikeInventory();
  };

  window.gbIncomingLikeInventoryCheck = function(){
    return {
      version: window.GB_VERSION,
      hasV311Css: !!document.getElementById("gbV311IncomingLikeInventoryCss"),
      mobile: window.innerWidth <= 760,
      incomingRows: document.querySelectorAll("#incomingTable tr").length
    };
  };
})();
