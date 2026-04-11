---
paths:
  - "sidecar/services/**"
---

# Sidecar 關鍵服務

`sidecar/services/` 下的 15 個業務邏輯模組。編輯或新增服務時需注意各服務之間的依賴關係（例如 `scheduler.py` 驅動 `github.py` + `snapshot.py`，`context_fetcher.py` 依賴 `hacker_news.py`）。

| 服務                    | 說明                            |
|-----------------------|-------------------------------|
| `github.py`           | GitHub API 客戶端（Rate Limit 感知） |
| `github_auth.py`      | OAuth Device Flow 驗證          |
| `analyzer.py`         | Star 速度與信號計算                  |
| `scheduler.py`        | APScheduler 背景排程（含失敗追蹤機制）     |
| `anomaly_detector.py` | 異常偵測（批次預載 active signals）     |
| `backup.py`           | SQLite 資料庫備份與還原               |
| `context_fetcher.py`  | HackerNews 上下文資訊彙整            |
| `hacker_news.py`      | Hacker News Algolia API 客戶端   |
| `recommender.py`      | 相似 repo 推薦（topics + language） |
| `snapshot.py`         | Repo 快照更新（metadata + signals） |
| `alerts.py`           | 警報規則評估與觸發                     |
| `queries.py`          | 共用 DB 查詢工具                    |
| `settings.py`         | 應用設定管理（Keyring 整合）            |
| `rate_limiter.py`     | API 請求限速與指數退避重試               |
| `weekly_summary.py`   | 每週摘要報告生成                      |
