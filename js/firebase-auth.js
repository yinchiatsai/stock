/*
  金雀庫存管理系統 v9｜Google 登入設定檔

  使用前請做兩件事：
  1. 到 Firebase Console 建立專案
  2. 將 Firebase 專案設定中的 firebaseConfig 貼到下面
  3. 將 USER_ROLES 裡的 email 改成實際人員的 Google 帳號

  角色：
  boss    = 老闆，管理者權限
  qing    = 青，管理者權限
  process = 製程人員，可更新庫存 / 到貨
  staff   = 美編 / 全員，只能查看
*/

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const USER_ROLES = {
  "boss@example.com": "boss",
  "qing@example.com": "qing",
  "process@example.com": "process",
  "staff@example.com": "staff"
};

const ROLE_LABEL = {
  boss: "老闆",
  qing: "青",
  process: "製程人員",
  staff: "全員 / 美編"
};

window.GB_AUTH = {
  user: null,
  role: "staff",
  ready: false,
  demoMode: false
};

function isFirebaseConfigReady() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_");
}

function applyRoleToUI(role, userText) {
  window.GB_AUTH.role = role || "staff";
  window.GB_AUTH.ready = true;

  const roleSelect = document.getElementById("roleSelect");
  const userInfoText = document.getElementById("userInfoText");
  const authPanel = document.getElementById("authPanel");

  if (roleSelect) {
    roleSelect.value = window.GB_AUTH.role;
    roleSelect.disabled = true;
  }

  if (userInfoText) {
    userInfoText.textContent = userText || ROLE_LABEL[window.GB_AUTH.role] || "已登入";
  }

  document.body.classList.remove("is-logged-out");
  document.body.classList.add("is-logged-in");

  if (authPanel) authPanel.classList.add("hidden");

  window.dispatchEvent(new CustomEvent("gb-role-ready", {
    detail: { role: window.GB_AUTH.role, user: window.GB_AUTH.user }
  }));
}

function showLoggedOut(message) {
  const authPanel = document.getElementById("authPanel");
  const authMessage = document.getElementById("authMessage");

  document.body.classList.add("is-logged-out");
  document.body.classList.remove("is-logged-in");

  if (authPanel) authPanel.classList.remove("hidden");
  if (authMessage && message) authMessage.textContent = message;
}

async function loginWithGoogle() {
  if (!isFirebaseConfigReady()) {
    showLoggedOut("尚未填入 Firebase config。請先設定 Firebase，或暫時使用測試模式。");
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  await firebase.auth().signInWithPopup(provider);
}

async function logoutGoogle() {
  if (window.GB_AUTH.demoMode) {
    window.GB_AUTH.demoMode = false;
    window.GB_AUTH.user = null;
    showLoggedOut("已登出測試模式。");
    return;
  }

  if (isFirebaseConfigReady()) {
    await firebase.auth().signOut();
  } else {
    showLoggedOut("已登出。");
  }
}

function loginDemo() {
  window.GB_AUTH.demoMode = true;
  window.GB_AUTH.user = { email: "demo-boss@example.com", displayName: "測試老闆" };
  applyRoleToUI("boss", "測試模式｜老闆");
}

document.addEventListener("DOMContentLoaded", () => {
  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const demoLoginBtn = document.getElementById("demoLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (googleLoginBtn) googleLoginBtn.addEventListener("click", loginWithGoogle);
  if (demoLoginBtn) demoLoginBtn.addEventListener("click", loginDemo);
  if (logoutBtn) logoutBtn.addEventListener("click", logoutGoogle);

  showLoggedOut(isFirebaseConfigReady()
    ? "請使用公司授權的 Google 帳號登入。"
    : "尚未設定 Firebase config。可先用測試模式查看系統。"
  );

  if (!isFirebaseConfigReady()) return;

  firebase.initializeApp(firebaseConfig);

  firebase.auth().onAuthStateChanged(user => {
    if (!user) {
      window.GB_AUTH.user = null;
      showLoggedOut("請使用公司授權的 Google 帳號登入。");
      return;
    }

    const role = USER_ROLES[user.email] || "staff";

    window.GB_AUTH.user = {
      email: user.email,
      displayName: user.displayName
    };

    applyRoleToUI(role, `${user.displayName || user.email}｜${ROLE_LABEL[role]}`);
  });
});
