"""封存的 repo 預設不該出現在任何查詢裡，除非顯式 opt-out。

為什麼把預設反過來而不是逐處加條件：repo 的查詢點有 29 處，而且需要相反的行為——
列表與計數必須排除封存的，依 full_name 或 id 的查找卻必須找得到它們。在 29 個地方
各判斷一次，漏一個就是滲漏。
"""
from datetime import datetime

from sqlalchemy import text

from db.models import Repo
from db.soft_delete import include_archived


def _seed(db):
    db.add(Repo(owner="a", name="live", full_name="a/live",
                url="https://github.com/a/live", github_id=1))
    db.add(Repo(owner="a", name="gone", full_name="a/gone",
                url="https://github.com/a/gone", github_id=2,
                unstarred_at=datetime(2026, 8, 16)))
    db.commit()


def test_archived_repo_is_absent_by_default(test_db):
    _seed(test_db)
    names = {r.full_name for r in test_db.query(Repo).all()}
    assert names == {"a/live"}
    assert test_db.query(Repo).count() == 1


def test_lookup_by_full_name_misses_archived_by_default(test_db):
    """這正是新增 repo 時的存在性檢查會踩到的行為。"""
    _seed(test_db)
    assert test_db.query(Repo).filter(Repo.full_name == "a/gone").first() is None


def test_opt_out_sees_archived(test_db):
    _seed(test_db)
    assert {r.full_name for r in include_archived(test_db.query(Repo)).all()} == \
        {"a/live", "a/gone"}
    assert include_archived(
        test_db.query(Repo)).filter(Repo.full_name == "a/gone").first() is not None


def test_bulk_delete_is_not_filtered(test_db):
    """事件只攔 SELECT。清空所有資料必須真的清空，包含封存的。"""
    _seed(test_db)
    test_db.query(Repo).delete()
    test_db.commit()
    assert test_db.execute(text("select count(*) from repos")).scalar() == 0
