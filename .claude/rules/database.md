---
paths:
  - "sidecar/db/**"
  - "sidecar/alembic/**"
  - "sidecar/alembic*"
---

# 資料庫

SQLite 位於 `sidecar/starscope.db`（11 張表）：

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

遷移工具：Alembic（`sidecar/alembic.ini`）
