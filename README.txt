金雀庫存管理系統 v13｜Firestore Clean

本版用途：
- 移除 Firebase Storage 依賴
- 保留 Google 登入
- 保留 Firestore 同步
- 圖片只做本機預覽，不上傳雲端
- 可在 Firebase Spark 免費方案下使用

部署：
1. 將本壓縮檔解壓縮。
2. 用全部檔案覆蓋 GitHub repo：yinchiatsai.github.io/stock 對應的 repo。
3. Commit changes。
4. 等 GitHub Pages 更新 1 分鐘。
5. 打開 https://yinchiatsai.github.io/stock/
6. Mac 強制重新整理：Command + Shift + R

Console 測試：
typeof startRemoteSync
typeof queueRemoteSave
typeof saveDataToFirebase

三個都應該不是 undefined。
登入後右上角同步狀態應從「尚未同步」變成「同步連線中…」或「已同步」。

Firestore 資料位置：
system / main
