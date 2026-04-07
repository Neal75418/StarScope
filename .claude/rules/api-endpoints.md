---
paths:
  - "sidecar/routers/**"
  - "src/api/**"
---

# API 端點

所有端點使用統一 `ApiResponse[T]` 格式回傳 `{success, data, message, error}`。
前端 `client.ts` 的 `doFetch` 自動 unwrap `data` 欄位。

| 路由模組              | 前綴                     | 主要端點                                  |
|-------------------|------------------------|---------------------------------------|
| `repos`           | `/api`                 | repos CRUD、手動 fetch、batch fetch-all   |
| `alerts`          | `/api/alerts`          | 規則 CRUD、triggered 列表、acknowledge      |
| `trends`          | `/api/trends`          | velocity / delta-7d / acceleration 排行 |
| `categories`      | `/api/categories`      | 分類 CRUD、tree 結構、repo 歸類管理             |
| `early_signals`   | `/api/early-signals`   | 信號列表、summary、acknowledge、batch        |
| `context`         | `/api/context`         | HN signals / badges、batch badges      |
| `charts`          | `/api/charts`          | Star 歷史圖表資料（7d/30d/90d）               |
| `recommendations` | `/api/recommendations` | 相似 repo、相似度計算、recalculate             |
| `discovery`       | `/api/discovery`       | GitHub 搜尋（rate limited 30/min）        |
| `star_history`    | `/api/star-history`    | Star 歷史回填（< 5000 stars）               |
| `comparison`      | `/api/comparison`      | 多專案對比圖表資料                             |
| `weekly_summary`  | `/api/summary`         | 每週摘要報告                                |
| `export`          | `/api/export`          | Watchlist JSON/CSV 匯出                 |
| `github_auth`     | `/api/github-auth`     | OAuth Device Flow、連線狀態                |
| `app_settings`    | `/api/settings`        | 排程間隔、快照保留、偵測門檻等設定管理                   |
| `health`          | `/api`                 | 健康檢查                                  |
| `dependencies`    | `/api/dependencies`    | 共用依賴注入                                |
