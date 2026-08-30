"""既有資料庫的欄位補齊測試。

為什麼需要這個檔案：Base.metadata.create_all() 只建新表，對已存在的表完全不動。
所以在模型上加欄位，對開發者的空資料庫是無感的，對使用者既有的資料庫卻會在
第一次查詢時炸「no such column」——這個落差只有在真實的舊資料庫上才看得見，
一般的端點測試每次都從空白 schema 起跑，永遠測不到。
"""
import pytest
import sqlalchemy as sa

from db.database import SchemaNeedsMigration, ensure_columns
from db.models import Base


def _columns(engine: sa.Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def _old_db(path, omit: dict[str, list[str]]) -> sa.Engine:
    """造一個「使用者的舊資料庫」：用目前的 model 建表，再刪掉指定欄位。

    比手寫 CREATE TABLE 真實——欄位、型別、約束都與正式 schema 一致，而且不會
    隨 model 演進而腐爛。手寫骨架漏掉某個 NOT NULL 欄位時，測到的就不再是
    「使用者的舊資料庫」，而是一個現實中不存在的形狀。
    """
    engine = sa.create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for table, cols in omit.items():
            for c in cols:
                conn.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN {c}"))
    return engine


def test_missing_columns_are_restored_without_touching_rows(tmp_path):
    """跨多張表一次補齊，既有資料原封不動。

    這幾個欄位正是專案演進中陸續加上的（repos 的 star 狀態、context_signals
    的 tags、early_signals 的訊號模板參數）——真實使用者的舊資料庫就是缺這些。
    """
    omit = {
        "repos": ["starred_at", "unstarred_at"],
        "context_signals": ["tags"],
        "early_signals": ["baseline_value", "context_title"],
    }
    engine = _old_db(tmp_path / "old.db", omit)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO repos (id, owner, name, full_name, url, added_at, updated_at) "
            "VALUES (1, 'a', 'one', 'a/one', 'https://github.com/a/one', "
            "'2026-01-01', '2026-01-01')"
        ))

    for table, cols in omit.items():
        assert not set(cols) & _columns(engine, table), f"{table} 的前提不成立"

    ensure_columns(engine)

    for table, cols in omit.items():
        assert set(cols) <= _columns(engine, table), f"{table} 沒補齊"

    with engine.connect() as conn:
        row = conn.execute(sa.text(
            "SELECT full_name, starred_at, unstarred_at FROM repos WHERE id = 1")).one()
    assert row[0] == "a/one", "既有資料必須原封不動"
    assert row[1] is None and row[2] is None, "補上的欄位對既有列應為 NULL"


def test_source_of_truth_is_the_model_not_a_hand_written_list(tmp_path):
    """任一個可為空的欄位被刪掉都補得回來——不需要在任何地方登記。

    先前靠手工維護的清單：漏登記時開發者的空資料庫由 create_all() 建好、
    一切正常，只有既有使用者會炸，而那是本機重現不出來的。改成從 model
    metadata 推導後，「忘了登記」這個失敗模式不存在。
    """
    # 刻意挑「從來沒有出現在任何登記清單裡」的欄位——它們從初始 schema
    # 就存在，所以舊機制永遠不會補它們。能補回來才證明來源是 model 而非清單。
    # （被索引或約束涵蓋的欄位 SQLite 不允許 DROP，所以取樣限於可刪的那些）
    never_registered = ["velocity_value", "star_count", "percentile_rank"]

    engine = _old_db(tmp_path / "any.db", {"early_signals": never_registered})
    assert not set(never_registered) & _columns(engine, "early_signals")

    ensure_columns(engine)

    assert set(never_registered) <= _columns(engine, "early_signals")


def test_running_twice_is_a_no_op(tmp_path):
    """啟動時每次都會跑，所以重複執行不能出錯。"""
    engine = _old_db(tmp_path / "twice.db", {"repos": ["starred_at"]})

    ensure_columns(engine)
    ensure_columns(engine)  # 不該拋 duplicate column name

    assert "starred_at" in _columns(engine, "repos")


def test_absent_table_is_skipped(tmp_path):
    """全新資料庫在 create_all 之前沒有任何表，這裡不該試圖 ALTER 不存在的表。"""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")

    ensure_columns(engine)  # 不該拋 no such table

    assert _columns(engine, "repos") == set()


def test_not_null_without_default_fails_loudly(tmp_path):
    """補不了的差異要當場拋錯，不能默默跳過。

    SQLite 本來就不允許對既有表加「NOT NULL 又沒有預設值」的欄位。默默跳過的話
    app 會照常啟動，然後在某個查詢碰到那個欄位時才炸——更晚、更難追。
    這個例外就是「該正式引入 alembic 了」的訊號。
    """
    engine = _old_db(tmp_path / "notnull.db", {"repos": ["updated_at"]})

    with pytest.raises(SchemaNeedsMigration, match="repos.updated_at"):
        ensure_columns(engine)
