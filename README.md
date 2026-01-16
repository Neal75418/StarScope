# StarScope

**GitHub Project Intelligence for Engineers**

StarScope 是一個**桌面工具**，幫工程師「看懂 GitHub 專案正在不正在變熱」。
對外聚焦 **GitHub**，對內設計為**可擴充的工程師百寶箱（Toolbox）**。

---

## 一句話定位

**StarScope = 用趨勢、速度、訊號，而不是單純 Star 數，來觀察 GitHub 專案。**

它不是第二個 GitHub Explore，而是：

* 你自己的觀察視角
* 你自己的 watchlist
* 你自己的規則與警報

---

## 為什麼要做 StarScope

GitHub 本身提供：

* Star 總數
* 基本趨勢頁

但它**沒有幫你做**：

* Star 成長速度（velocity）
* 熱度變化（acceleration）
* 同類專案對比
* 長期歷史觀察
* 個人化追蹤與預警

StarScope 補的正是這一塊。

---

## 產品哲學

* 第一版**只專注 GitHub**
* 架構從一開始就為「百寶箱」設計
* 功能不是堆疊，而是「訊號（Signal）」

> 百寶箱不是現在就端出來的東西，而是未來可以順勢長出來的能力。

---

## 核心概念模型

StarScope 關心的不是網站，而是「工程師判斷會用到的訊號」。

### Entity（被觀察的對象）

* GitHub Repository（第一版）
* 未來：Package、Framework、Tool

### Signal（訊號）

* `stars_delta_7d` - 7 天新增 Star
* `stars_delta_30d` - 30 天新增 Star
* `velocity` - stars/day
* `acceleration` - 成長率變化
* `release_event` - 版本發布（未來）
* `activity_score` - 活躍度（未來）

### Observation（觀測快照）

* 每天或每次抓取的資料快照
* 用來做趨勢與長期比較

---

## 第一版功能範圍（MVP）

### 1. Watchlist

你主動追蹤的 Repo 清單。

顯示資訊：

* 總 Star 數
* 7 / 30 天新增 Star
* Velocity（stars/day）
* 趨勢箭頭（↑ ↓ →）

### 2. Trends（熱度排行）

* 近 7 / 30 天：
  * 成長最快
  * 加速最快
* 可排序、可篩選

### 3. Alerts（個人規則）

可設定的規則例如：

* 7 天新增 Star > 200
* Velocity 突然翻倍

觸發時：

* 桌面通知
* 標記為 Hot Repo

---

## 技術架構

```
┌─────────────────────────────────────────────────┐
│                  Tauri Shell                     │
│  ┌───────────────────┐  ┌────────────────────┐  │
│  │   Web Frontend    │  │   Rust Backend     │  │
│  │  (React + TS)     │  │  (IPC + Sidecar)   │  │
│  └─────────┬─────────┘  └──────────┬─────────┘  │
│            │                       │             │
│            │   ← HTTP API →        │             │
│            │                       ▼             │
│            │            ┌─────────────────────┐  │
│            └───────────►│  Python Sidecar    │  │
│                         │  (FastAPI Server)  │  │
│                         │  - Fetch GitHub    │  │
│                         │  - Analyze Signals │  │
│                         │  - Store SQLite    │  │
│                         └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 技術棧

| 層級 | 技術 | 說明 |
|------|------|------|
| **桌面框架** | Tauri v2 | 原生視窗、系統托盤、桌面通知 |
| **前端** | React + TypeScript | UI 介面 |
| **後端核心** | Python 3.12+ | 資料引擎（sidecar） |
| **API 框架** | FastAPI | 提供 HTTP API 給前端呼叫 |
| **資料處理** | pandas + httpx | 分析與 HTTP 請求 |
| **本地儲存** | SQLite | 本地資料庫 |

### 資料引擎負責

* **Fetch** - 抓資料
* **Normalize** - 統一格式
* **Analyze** - 計算訊號
* **Store** - 存入 SQLite

---

## 本地資料模型

### repos
| 欄位 | 說明 |
|------|------|
| id | 主鍵 |
| owner | 擁有者 |
| name | 專案名稱 |
| full_name | 完整名稱 |
| url | GitHub URL |
| created_at | 建立時間 |

### repo_snapshots
| 欄位 | 說明 |
|------|------|
| repo_id | 關聯 repo |
| stars | Star 數 |
| snapshot_date | 快照日期 |
| fetched_at | 抓取時間 |

### signals
| 欄位 | 說明 |
|------|------|
| repo_id | 關聯 repo |
| signal_type | 訊號類型 |
| value | 數值 |
| calculated_at | 計算時間 |

### alerts
| 欄位 | 說明 |
|------|------|
| repo_id | 關聯 repo |
| rule | 規則 |
| triggered_at | 觸發時間 |

---

## 資料流程

```
1. 讀取 Watchlist
2. 呼叫 GitHub API 抓最新資料
3. 存 Snapshot
4. 計算 Signals
5. 評估 Alert 規則
6. 更新 UI / 發送通知
```

---

## 專案結構

```
StarScope/
├── src/                    # React 前端
│   ├── components/
│   ├── pages/
│   └── App.tsx
│
├── src-tauri/              # Tauri (Rust)
│   ├── src/main.rs
│   └── tauri.conf.json
│
└── sidecar/                # Python 資料引擎
    ├── main.py             # FastAPI 入口
    ├── requirements.txt
    ├── routers/
    │   └── health.py
    └── services/
        └── github.py
```

---

## 開發指南

### 前置需求

* Node.js 18+
* Rust (Tauri 需要)
* Python 3.9+

### 安裝依賴

```bash
# 前端依賴
npm install

# Python 依賴
cd sidecar
pip install -r requirements.txt
```

### 開發模式

```bash
# 終端機 1：啟動 Python sidecar
cd sidecar
python main.py

# 終端機 2：啟動 Tauri 開發模式
npm run tauri dev
```

### 測試 API

```bash
curl http://127.0.0.1:8008/api/health
```

---

## 實作注意事項

* **GitHub API rate limit** - 必須做快取與增量更新
* **資料正確性** - 用 snapshot 差分算 delta
* **長期價值** - 不刪舊資料，歷史越久越有價值

---

## 推進節奏

### Phase 1（能用）

* GitHub Watchlist
* Star delta / velocity
* SQLite 儲存
* 基本 UI

### Phase 2（好用）

* Alerts 規則引擎
* 排名與趨勢視圖
* 桌面通知

### Phase 3（百寶箱成形）

* 第二個 Signal 來源
* Plugin 化架構
* 完整桌面打包

---

## 未來擴充（現在不做）

* Releases Tracker（版本節奏）
* Issue / Discussion 活躍度
* Ecosystem 比較（例如 Electron vs Tauri）
* Hacker News / Reddit 討論熱度
* NPM / PyPI 下載趨勢

**所有來源都轉成 Signal，而不是直接暴露網站。**

---

## 最終定義

**StarScope 現在是 GitHub 工具，但它天生就是工程師百寶箱的第一把工具。**
