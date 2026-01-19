---
name: python-sidecar
description: Expert guidance on Python Data Engine (FastAPI + SQLite)
---

# Python Sidecar Guide

本專案的核心邏輯 (Fetching, Analysis, Storage) 都在 Python 層。

## 1. Architecture

- **FastAPI**:
  - 啟動時隨機或指定 Port (8008)，但要避免 Port 衝突。
  - 使用 `APScheduler` 定期執行 GitHub Fetching 任務。

- **Database (SQLite)**:
  - 使用 SQLAlchemy ORM。
  - DB 檔案應存放在 `APP_DATA_DIR` (由 Rust 傳入路徑或透過環境變數約定)，**嚴禁** 寫在程式執行目錄 (會被打包封裝導致無法寫入)。

## 2. GitHub API Interaction

- **Rate Limiting**:
  - 嚴格遵守 GitHub API Rate Limit。
  - 實作 Exponential Backoff 重試機制。
  - 支援 User Access Token 以獲得更高的 Quota (5000 requests/hr)。

## 3. Data Analysis

- **Pandas/Polars**:
  - 使用 Pandas 處理時間序列數據 (Star Velocity)。
  - `Context Signal` (Hacker News, Reddit) 的爬蟲要設定適當的 Headers 與 Timeout，避免被封鎖。
