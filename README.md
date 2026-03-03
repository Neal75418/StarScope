<div align="center">

# ⭐ StarScope

**GitHub Project Intelligence for Engineers**

_Don't just count stars — catch rising stars early._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Neal75418/StarScope/actions/workflows/test.yml/badge.svg)](https://github.com/Neal75418/StarScope/actions/workflows/test.yml)
[![Release](https://github.com/Neal75418/StarScope/actions/workflows/release.yml/badge.svg)](https://github.com/Neal75418/StarScope/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/Neal75418/StarScope/branch/main/graph/badge.svg)](https://codecov.io/gh/Neal75418/StarScope)

![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.129+-009688?logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?logo=sqlite&logoColor=white)

</div>

---

StarScope 是一款開源桌面應用，幫助工程師以**動能（velocity）**而非絕對數字追蹤 GitHub 專案趨勢。
透過 star 加速度分析、異常偵測與 Hacker News 情境整合，讓你在眾人之前發現 Rising Star。

**為什麼選擇 StarScope？**

- 📡 **動能追蹤** — 觀察速度與加速度，而非靜態 star 數字
- 🔔 **主動通知** — 自訂警報規則 + OS 層級推播通知
- 🧠 **智慧推薦** — 基於 topics 與語言的相似專案推薦
- 📊 **儀表板總覽** — 一眼掌握所有追蹤專案的關鍵指標

> **核心定位**：StarScope 是工程師的「專案雷達」，不是「專案目錄」。

---

## 🗺️ 功能一覽

```mermaid
mindmap
  root((StarScope))
    追蹤與分析
      Watchlist 專案追蹤
      Velocity / Acceleration 分析
      7/30/90 天趨勢偵測
      Star 歷史回填
      Commit 活動追蹤
      語言分佈分析
    警報與通知
      自訂警報規則
      應用內通知中心
      OS 層級推播通知
      Hacker News 熱門偵測
    智慧功能
      相似專案推薦
      早期訊號偵測
      異常偵測 Sudden Spike
      Dashboard 儀表板
    資料管理
      批次匯入 CSV/JSON/TXT
      JSON / CSV 匯出
      樹狀分類管理
      GitHub OAuth 認證
    使用者體驗
      中／英雙語
      淺色／深色主題
      虛擬滾動
      頁面過場動畫
```

---

## 🏗️ 技術架構

```mermaid
graph TB
    subgraph Desktop["Desktop Client"]
        direction TB
        subgraph UI["React 19 + TypeScript"]
            Pages["Pages\nDashboard / Watchlist / Trends\nDiscovery / Settings"]
            Components["Components\nRepoCard / Charts / Badges\nNotificationCenter"]
        end
        subgraph Native["Rust Native"]
            Tray["System Tray"]
            Notify["OS Notifications"]
        end
        Pages --> Components
    end

    subgraph Engine["Data Engine — Python 3.12"]
        direction TB
        API["FastAPI :8008"]
        subgraph Services["Core Services"]
            Fetch["GitHub Fetcher"]
            Analyze["Signal Analyzer"]
            Detect["Anomaly Detector"]
            Recommend["Recommender"]
        end
        subgraph Data["Data Layer"]
            DB[("SQLite")]
            Sched["APScheduler"]
        end
        API --> Services
        Services --> Data
        Sched -.->|hourly| Fetch
    end

    subgraph Ext["External"]
        GH["GitHub API"]
        HN["Hacker News API"]
    end

    Components <-->|HTTP/JSON| API
    Native -.->|IPC| API
    Fetch --> GH
    Analyze --> HN

    classDef desktop fill:#1e293b,stroke:#334155,color:#f8fafc,font-weight:bold
    classDef engine fill:#0f172a,stroke:#1e3a5f,color:#e2e8f0,font-weight:bold
    classDef ext fill:#312e81,stroke:#4338ca,color:#e0e7ff,font-weight:bold
    classDef node_default fill:#1e40af,stroke:#1d4ed8,color:#fff

    class Desktop desktop
    class Engine engine
    class Ext ext
```

| 層級   | 技術                       | 版本            |
|------|--------------------------|---------------|
| 桌面框架 | Tauri                    | v2            |
| 前端   | React + TypeScript       | 19 / 5.8      |
| 狀態管理 | React Query + useReducer | v5            |
| 後端   | Python + FastAPI         | 3.12 / 0.129+ |
| 儲存   | SQLite + SQLAlchemy      | —             |
| 動畫   | Framer Motion            | 12            |
| 虛擬滾動 | react-window             | v2            |

---

## 🚀 快速開始

### 前置需求

| 工具      | 版本            |
|---------|---------------|
| Node.js | 20+ (LTS)     |
| Rust    | latest stable |
| Python  | 3.12+         |

### 安裝

```bash
git clone https://github.com/Neal75418/StarScope.git
cd StarScope

# 前端依賴
npm install

# Python 依賴
cd sidecar && pip install -r requirements.txt && cd ..

# 環境設定（選用，提升 GitHub API 配額）
cp sidecar/.env.example sidecar/.env
# 編輯 sidecar/.env 填入 GITHUB_CLIENT_ID 或 GITHUB_TOKEN
```

### 開發模式

```bash
# 終端機 1 — Python sidecar
cd sidecar && python main.py

# 終端機 2 — Tauri 開發模式
npm run tauri dev
```

### 建置與測試

```bash
npm run tauri build              # 建置桌面應用

npm run test                     # 前端單元測試
cd sidecar && pytest tests/ -v   # 後端測試
npm run test:e2e                 # E2E 測試
```

---

## 📂 專案結構

```
StarScope/
├── src/                           # React 前端（TypeScript）
│   ├── api/                       #   API 客戶端 + 自動生成型別
│   ├── components/                #   UI 元件
│   │   ├── motion/                #     Framer Motion 動畫包裝
│   │   ├── settings/              #     設定頁面元件
│   │   └── ...
│   ├── constants/                 #   API、訊號類型、語言色彩
│   ├── contexts/                  #   WatchlistContext + Reducer
│   ├── hooks/                     #   45 個 Custom Hooks
│   │   └── selectors/             #     Watchlist selector hooks
│   ├── i18n/                      #   英／繁中翻譯
│   ├── lib/                       #   React Query 設定
│   ├── pages/                     #   5 個頁面
│   │   ├── Dashboard.tsx          #     儀表板總覽
│   │   ├── Watchlist.tsx          #     追蹤清單（虛擬滾動）
│   │   ├── Trends.tsx             #     趨勢排行
│   │   ├── Discovery.tsx          #     探索 GitHub
│   │   └── Settings.tsx           #     設定與警報管理
│   ├── theme/                     #   淺色／深色主題
│   ├── types/                     #   共用 TypeScript 型別
│   └── utils/                     #   工具函式（13 個模組）
│
├── src-tauri/                     # Tauri 桌面層（Rust）
│   ├── src/
│   │   ├── main.rs                #   進入點
│   │   └── lib.rs                 #   Sidecar、Tray、Notification
│   ├── capabilities/              #   安全權限設定
│   └── tauri.conf.json            #   視窗、CSP、Bundle 設定
│
├── sidecar/                       # Python 資料引擎
│   ├── main.py                    #   FastAPI 入口（port 8008）
│   ├── routers/                   #   15 個路由模組（64 個端點）
│   ├── services/                  #   14 個業務邏輯服務
│   ├── schemas/                   #   Pydantic 資料模型
│   ├── db/                        #   SQLite + SQLAlchemy（13 張表）
│   ├── middleware/                 #   日誌 + 限速中介層
│   ├── alembic/                   #   資料庫遷移
│   └── tests/                     #   pytest 後端測試（373+ 個）
│
├── e2e/                           # Playwright E2E 測試
└── .github/workflows/             # CI/CD（test + release）
```

---

## 🔌 API 端點

所有端點使用統一 `ApiResponse[T]` 格式回傳 `{success, data, message, error}`。
共 **15 個路由模組**、**64 個端點**：

| 路由模組              | 前綴                     | 說明                                    |
|-------------------|------------------------|---------------------------------------|
| `repos`           | `/api`                 | Repo CRUD、手動 fetch、批次刷新               |
| `alerts`          | `/api/alerts`          | 警報規則 CRUD、觸發記錄、確認                     |
| `trends`          | `/api/trends`          | 趨勢排行（velocity / delta / acceleration） |
| `categories`      | `/api/categories`      | 分類管理、tree 結構、repo 歸類                  |
| `early_signals`   | `/api/early-signals`   | 早期信號、異常偵測、批次確認                        |
| `context`         | `/api/context`         | HN 情境信號與徽章                            |
| `charts`          | `/api/charts`          | Star 歷史圖表資料（7d/30d/90d）               |
| `recommendations` | `/api/recommendations` | 相似 repo 推薦、相似度計算                      |
| `discovery`       | `/api/discovery`       | GitHub 搜尋（限速 30/min）                  |
| `commit_activity` | `/api/commit-activity` | Commit 活動與摘要                          |
| `languages`       | `/api/languages`       | 程式語言分佈                                |
| `star_history`    | `/api/star-history`    | Star 歷史回填（< 5000 stars）               |
| `export`          | `/api/export`          | Watchlist JSON / CSV 匯出               |
| `github_auth`     | `/api/github-auth`     | OAuth Device Flow、連線狀態                |
| `health`          | `/api`                 | 健康檢查                                  |

> 📖 完整 API 文件可在開發模式下存取：`http://localhost:8008/api/docs`（Swagger）/ `http://localhost:8008/api/redoc`（ReDoc）

---

## 📋 開發狀態

**功能完整** — 專注核心價值的精簡設計。

| 模組           | 涵蓋範圍                                        |
|--------------|---------------------------------------------|
| 🎯 核心追蹤      | Watchlist、Velocity 分析、趨勢偵測、Star 歷史回填        |
| 🔔 訊號系統      | HN 整合、警報規則、OS 推播通知、應用內通知中心                  |
| 🧠 智慧功能      | 相似推薦、早期訊號偵測、Dashboard 儀表板                   |
| 📦 資料管理      | 批次匯入（CSV/JSON/TXT）、JSON/CSV 匯出、樹狀分類         |
| 🌐 國際化與 UX   | 英／繁中雙語、深淺主題、虛擬滾動、頁面動畫                       |
| 🔑 GitHub 整合 | OAuth Device Flow、Rate Limit 感知、安全 Token 管理 |

> **測試覆蓋**：前端 665 + 後端 373 = **1,038+ 個測試案例**（86%+ 分支覆蓋率）

---

## 🏆 競品比較

| 產品              | 定位    | StarScope 差異  |
|-----------------|-------|---------------|
| GitHub Trending | 今日熱門  | 觀察「動能」而非「絕對值」 |
| Star History    | 歷史曲線  | 主動警報 + OS 通知  |
| OSS Insight     | 資料儀表板 | 桌面原生 + 異常偵測   |
| LibHunt         | 分類索引  | 專注追蹤、警報與智慧推薦  |

---

## 🤝 貢獻

歡迎貢獻！詳見 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
git checkout -b feature/your-feature    # 建立分支
git commit -m "feat: ..."              # 提交修改（Conventional Commits）
git push origin feature/your-feature    # 推送並開啟 PR
```

---

## 📄 授權

本專案採用 [MIT License](LICENSE)。

---

## 🙏 致謝

[Tauri](https://tauri.app/) ·
[React](https://react.dev/) ·
[FastAPI](https://fastapi.tiangolo.com/) ·
[React Query](https://tanstack.com/query) ·
[Recharts](https://recharts.org/) ·
[Framer Motion](https://www.framer.com/motion/) ·
[SQLAlchemy](https://www.sqlalchemy.org/) ·
[react-window](https://github.com/bvaughn/react-window)

---

<div align="center">

Made with ❤️ by engineers, for engineers.

</div>
