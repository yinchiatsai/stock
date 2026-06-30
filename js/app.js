const STORAGE_KEY = "goldenbird_inventory_demo_v3";
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

  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== tab);
  });

  renderAll();
}

function renderAll() {
  renderInventory();
  renderIncoming();
  renderReceiveTable();
  renderAdmin();
  setManualOrderDefaultDate();
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
  const canEditSafety = role === "process" || role === "boss" || role === "qing";

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
  const canManage = role === "boss" || role === "qing";
  const personName = role === "qing" ? "青" : "老闆";

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
}

function selectMappingItem(item) {
  document.getElementById("mappingItemSearch").value = item.name;
  document.getElementById("mappingItemSelect").value = item.id;
  document.getElementById("mappingAutocompleteList").innerHTML = "";
}

function updateSafety(itemId, value) {
  const role = document.getElementById("roleSelect").value;
  if (!(role === "process" || role === "boss" || role === "qing")) {
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

  item.stock = qty;
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

function updateStock() {
  const itemId = document.getElementById("stockItemSelect").value;
  const qty = Number(document.getElementById("stockQtyInput").value);
  const item = getItem(itemId);

  if (!item || Number.isNaN(qty) || qty < 0) {
    showToast("請先搜尋並選擇品項，再輸入正確庫存");
    return;
  }

  item.stock = qty;
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

  if (item) item.stock += qty;

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
    disabled: false
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
  const person = role === "qing" ? "青" : "老闆";

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

function mockOCR() {
  const role = document.getElementById("roleSelect").value;
  const person = role === "qing" ? "青" : "老闆";

  const newOrder = {
    id: `O${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    itemId: "I002",
    qty: 100,
    received: 0,
    cost: 1280,
    source: "1688 模擬辨識",
    person,
    status: "在途"
  };

  data.orders.unshift(newOrder);
  lastCreatedOrderId = newOrder.id;

  saveData();
  renderAll();
  showToast("已模擬辨識：阿里巴巴品名已對應到「壓克力板 3mm」");
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

function initRole() {
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
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.getElementById("searchInput").addEventListener("input", renderInventory);
  document.getElementById("categoryFilter").addEventListener("change", renderInventory);
  document.getElementById("roleSelect").addEventListener("change", handleRoleChange);
  const clearRoleBtn = document.getElementById("clearRoleBtn");
  if (clearRoleBtn) clearRoleBtn.addEventListener("click", clearRole);
  document.getElementById("restockToggleBtn").addEventListener("click", toggleRestockOnly);
  document.getElementById("resetDemoBtn").addEventListener("click", resetDemoData);

  document.getElementById("stockSearchInput").addEventListener("input", () => {
    renderAutocomplete("stockSearchInput", "autocompleteList", selectStockItem);
  });

  document.getElementById("updateStockBtn").addEventListener("click", updateStock);
  safeOn("quickStockSearchInput", "input", () => {
    renderAutocomplete("quickStockSearchInput", "quickAutocompleteList", selectQuickStockItem);
  });
  safeOn("quickUpdateStockBtn", "click", quickUpdateStock);

  document.getElementById("mockOcrBtn").addEventListener("click", mockOCR);
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
  console.log("手機模式啟用");
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
});
