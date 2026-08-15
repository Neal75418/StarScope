"""同步的差異計算。純函式，不碰資料庫也不碰網路。"""
from datetime import datetime

from db.models import Repo
from services.star_sync import RemoteStar, diff_starred


def _local(github_id: int, full_name: str, unstarred: bool = False) -> Repo:
    owner, name = full_name.split("/")
    return Repo(id=github_id, owner=owner, name=name, full_name=full_name,
                url=f"https://github.com/{full_name}", github_id=github_id,
                unstarred_at=datetime(2026, 8, 1) if unstarred else None)


def _remote(github_id: int, full_name: str) -> RemoteStar:
    owner, name = full_name.split("/")
    return RemoteStar(github_id=github_id, full_name=full_name, owner=owner,
                      name=name, starred_at=datetime(2026, 8, 10), payload={})


def test_new_star_becomes_added():
    d = diff_starred(local=[], remote=[_remote(1, "a/one")])
    assert [r.full_name for r in d.added] == ["a/one"]
    assert d.restored == [] and d.renamed == [] and d.archived == []


def test_unstarred_on_github_becomes_archived():
    d = diff_starred(local=[_local(1, "a/one")], remote=[])
    assert [r.full_name for r in d.archived] == ["a/one"]
    assert d.added == []


def test_already_archived_repo_is_not_archived_again():
    d = diff_starred(local=[_local(1, "a/one", unstarred=True)], remote=[])
    assert d.archived == []


def test_restarred_repo_is_restored_not_added():
    """本機列還在（只是被封存），重新 star 必須復原而不是建新的一列。"""
    d = diff_starred(local=[_local(1, "a/one", unstarred=True)],
                     remote=[_remote(1, "a/one")])
    assert d.added == []
    assert [r.full_name for r, _ in d.restored] == ["a/one"]


def test_rename_is_not_an_archive_plus_add():
    """改名時 full_name 變、github_id 不變。

    用 full_name 比對會判成「舊的消失 + 新的出現」，於是封存舊列並建新列，
    歷史快照從此斷成兩截。
    """
    d = diff_starred(local=[_local(1, "a/old")], remote=[_remote(1, "a/new")])
    assert d.added == [] and d.archived == []
    assert [(repo.full_name, star.full_name) for repo, star in d.renamed] == \
        [("a/old", "a/new")]


def test_local_row_without_github_id_is_never_archived():
    """github_id 是比對鍵。沒有它就無從判斷遠端有沒有，不能當成「已取消 star」。"""
    orphan = _local(1, "a/orphan")
    orphan.github_id = None
    d = diff_starred(local=[orphan], remote=[_remote(2, "a/other")])
    assert d.archived == []


def test_matched_repo_gets_its_star_date_filled_in():
    """同步前就存在的 repo 也要拿到 starred_at。

    它以 github_id 比對得到，既不是新增也不是復原——若只在那兩個分支寫日期，
    這種 repo 永遠沒有 starred_at，而那是判斷「收藏多久」的唯一依據。
    實際發生過：首次同步後，唯一一筆同步前就存在的 repo 是全 DB 唯一沒有日期的。
    """
    local = _local(1, "a/one")
    local.starred_at = None

    d = diff_starred(local=[local], remote=[_remote(1, "a/one")])

    assert d.added == [] and d.restored == []
    assert [(r.full_name, s.starred_at) for r, s in d.restamped] == \
        [("a/one", datetime(2026, 8, 10))]


def test_an_unchanged_star_date_is_not_restamped():
    """已經對的日期不用再寫一次——避免每次同步都產生無謂的 UPDATE。"""
    local = _local(1, "a/one")
    local.starred_at = datetime(2026, 8, 10)

    d = diff_starred(local=[local], remote=[_remote(1, "a/one")])

    assert d.restamped == []
