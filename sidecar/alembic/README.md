# 這個目錄不在啟動路徑上

`sidecar/alembic/` 只保留一份 2026-01 的初始 schema 作為歷史基準，**沒有任何程式碼
引用它**，`alembic upgrade` 也不會在任何流程中被執行。

實際的 schema 維護在 `db/database.py`：

- `create_all()` — 建立新表
- `ensure_columns()` — 拿 `Base.metadata` 跟使用者的資料庫比對，補上缺少的欄位

加欄位不需要在任何地方登記。但它只會做 ADD COLUMN，而且只有這些差異**偵測得到**、
會拋 `SchemaNeedsMigration` 讓啟動當場失敗：新欄位 NOT NULL 又沒有 server_default；
新欄位帶外鍵、`unique=True`、`index=True` 或被表級約束涵蓋。改型別、改名、刪欄位、
在既有欄位上加索引或約束、需要回填資料——這些**偵測不到**，會靜默留著差異，只能
靠人判斷。碰到任何一種就是正式引入 alembic 的時機，判準寫在 CLAUDE.md 的「schema
變更」一節。

## 為什麼 alembic 還在 requirements.txt

它沒有任何執行期消費者：mypy 設了 `exclude = alembic/`，pytest 只跑 `tests/`，
PyInstaller 靠靜態 import 分析所以不會打包它。留著只為了讓這個目錄裡的檔案在
編輯器裡解析得出來（`from alembic import op`），以及日後真的要引入時不必重裝。

清理依賴時不要把它當成孤兒移除。
