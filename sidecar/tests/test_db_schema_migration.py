"""既有資料庫的欄位補齊測試。

為什麼需要這個檔案：Base.metadata.create_all() 只建新表，對已存在的表完全不動。
所以在模型上加欄位，對開發者的空資料庫是無感的，對使用者既有的資料庫卻會在
第一次查詢時炸「no such column」——這個落差只有在真實的舊資料庫上才看得見，
一般的端點測試每次都從空白 schema 起跑，永遠測不到。
"""
import sqlalchemy as sa

from db.database import ensure_columns


def _columns(engine: sa.Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def test_missing_column_is_added_to_an_existing_table_without_touching_rows(tmp_path):
    """模擬使用者的舊資料庫：表存在、缺欄位、有資料。"""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        # 刻意用舊 schema 手寫，而不是從模型建——從模型建就有新欄位了，測不到東西
        conn.execute(sa.text(
            "CREATE TABLE feed_items ("
            "id INTEGER PRIMARY KEY, candidate_id INTEGER, feed_date DATE, "
            "score FLOAT, reason_json VARCHAR(2048), feedback VARCHAR(20), "
            "created_at DATETIME)"
        ))
        conn.execute(sa.text(
            "INSERT INTO feed_items (id, candidate_id, feed_date, score, reason_json, feedback) "
            "VALUES (1, 1, '2026-08-01', 2.5, '{}', 'starred')"
        ))

    assert "opened_at" not in _columns(engine, "feed_items")
    ensure_columns(engine)
    assert "opened_at" in _columns(engine, "feed_items")

    with engine.connect() as conn:
        row = conn.execute(sa.text(
            "SELECT feedback, opened_at FROM feed_items WHERE id = 1")).one()
    assert row[0] == "starred", "既有資料必須原封不動"
    assert row[1] is None, "補上的欄位對既有列應為 NULL"


def test_running_twice_is_a_no_op(tmp_path):
    """啟動時每次都會跑，所以重複執行不能出錯。"""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'twice.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE feed_items (id INTEGER PRIMARY KEY)"))

    ensure_columns(engine)
    ensure_columns(engine)  # 不該拋 duplicate column name

    assert "opened_at" in _columns(engine, "feed_items")


def test_absent_table_is_skipped(tmp_path):
    """全新資料庫在 create_all 之前沒有任何表，這裡不該試圖 ALTER 不存在的表。"""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    ensure_columns(engine)  # 不該拋 no such table
    assert _columns(engine, "feed_items") == set()
