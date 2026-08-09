---
paths:
  - "sidecar/db/**"
  - "sidecar/alembic/**"
  - "sidecar/alembic*"
---

# 資料庫

SQLite 位於 **應用程式資料目錄**（16 張表）。實際路徑由 `db/database.py` 的 `get_app_data_dir()` 決定，優先序為 `STARSCOPE_DATA_DIR` 環境變數 → `TAURI_APP_DATA_DIR`（正式環境由 Tauri 注入）→ `~/.starscope`（開發回退）。**不在 repo 目錄底下**，除錯找資料庫時別在 `sidecar/` 裡找。

| 資料表                 | 說明                               |
|---------------------|----------------------------------|
| `repos`             | 追蹤中的 GitHub 儲存庫                  |
| `repo_snapshots`    | 時間點快照（stars、forks、watchers 等）    |
| `signals`           | 計算的速度信號（velocity、acceleration 等） |
| `alert_rules`       | 使用者定義的警報規則                       |
| `triggered_alerts`  | 已觸發的警報記錄                         |
| `context_signals`   | 外部情境信號（HN 提及）                    |
| `similar_repos`     | 相似 repo 關係與分數                    |
| `categories`        | 使用者自訂分類（支援階層 parent_id）          |
| `repo_categories`   | Repo ↔ Category 多對多關聯            |
| `early_signals`     | 異常偵測信號（rising star、spike 等）      |
| `app_settings`      | 應用設定（key-value，含 Keyring 整合）     |
| `interests`         | For You feed 興趣清單（term / kind / weight 1-3） |
| `exclude_terms`     | feed 黑名單詞（預設 awesome、interview、roadmap、tutorial） |
| `feed_candidates`   | feed 候選 repo 的 metadata 快取               |
| `feed_items`        | 每日 feed 產出（score、推薦理由 JSON、使用者回饋）      |
| `seen_repos`        | 已推薦過的 repo（防重複；dismissed 者永不再推）        |

遷移工具：Alembic（`sidecar/alembic.ini`）
