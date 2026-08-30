# 這個目錄不在啟動路徑上

`sidecar/alembic/` 只保留一份 2026-01 的初始 schema 作為歷史基準，**沒有任何程式碼
引用它**，`alembic upgrade` 也不會在任何流程中被執行。

實際的 schema 維護在 `db/database.py`：

- `create_all()` — 建立新表
- `ensure_columns()` — 拿 `Base.metadata` 跟使用者的資料庫比對，補上缺少的欄位

加欄位不需要在任何地方登記。碰到補不了的差異（改型別、改名、刪欄位、在既有表加
索引或約束、需要回填資料）會拋 `SchemaNeedsMigration`——**那就是正式引入 alembic
的時機**，判準寫在 CLAUDE.md 的「schema 變更」一節。
