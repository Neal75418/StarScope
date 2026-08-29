"""同步流程的守則。網路以 fake GitHub 取代。

三道守則的共同點：它們保護的是「不要在資訊不足時執行移除」。封存雖然可復原，
但一次誤封存整份追蹤清單仍是這個功能最貴的誤動作。
"""
from datetime import datetime

import pytest

from db.models import AppSettingKey, Repo
from services.settings import set_setting
from services.star_sync import RemoteStar, StarredFetch, sync_starred_repos


class FakeGitHub:
    def __init__(self, stars: list[RemoteStar] | None = None,
                 error: Exception | None = None, truncated: bool = False):
        self.stars = stars or []
        self.error = error
        self.truncated = truncated
        self.calls = 0

    async def get_user_starred_with_dates(self) -> "StarredFetch":
        self.calls += 1
        if self.error:
            raise self.error
        return StarredFetch(stars=self.stars, truncated=self.truncated)


def _star(github_id: int, full_name: str) -> RemoteStar:
    owner, name = full_name.split("/")
    return RemoteStar(github_id=github_id, full_name=full_name, owner=owner,
                      name=name, starred_at=datetime(2026, 8, 10),
                      payload={"id": github_id, "full_name": full_name,
                               "html_url": f"https://github.com/{full_name}",
                               "owner": {"login": owner}, "name": name})


def _tracked(db, github_id: int, full_name: str) -> Repo:
    owner, name = full_name.split("/")
    repo = Repo(owner=owner, name=name, full_name=full_name,
                url=f"https://github.com/{full_name}", github_id=github_id)
    db.add(repo)
    db.commit()
    return repo


@pytest.fixture(autouse=True)
def _has_token_and_not_first_sync(test_db, monkeypatch):
    """預設情境：已設定 token、且不是首次同步（首次同步的規則見 Task 5）。"""
    import services.star_sync as mod
    monkeypatch.setattr(mod, "get_setting", _fake_settings({
        AppSettingKey.GITHUB_TOKEN: "gho_fake",
        AppSettingKey.LAST_STAR_SYNC_AT: "2026-08-01T00:00:00Z",
    }))


def _fake_settings(values: dict) -> object:
    store = dict(values)

    def _get(key, db=None):
        return store.get(key)

    return _get


async def test_empty_response_never_archives_anything(test_db):
    """0 筆等於清空整個追蹤清單。這不該依賴「應該不會發生」。"""
    _tracked(test_db, 1, "a/one")

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[]))

    assert result.archived == 0
    assert result.skipped_reason == "empty_response"
    assert test_db.query(Repo).count() == 1


async def test_fetch_failure_never_archives_anything(test_db):
    _tracked(test_db, 1, "a/one")

    result = await sync_starred_repos(
        test_db, FakeGitHub(error=RuntimeError("offline")))

    assert result.archived == 0
    assert result.skipped_reason == "fetch_failed"
    assert test_db.query(Repo).count() == 1


async def test_missing_token_makes_no_request_at_all(test_db, monkeypatch):
    """不依賴「回傳 0 筆」那道閘兜底——根本不該送出請求。"""
    import services.star_sync as mod
    monkeypatch.setattr(mod, "get_setting", _fake_settings({}))

    gh = FakeGitHub(stars=[_star(1, "a/one")])
    result = await sync_starred_repos(test_db, gh)

    assert gh.calls == 0
    assert result.skipped_reason == "no_token"


async def test_a_normal_sync_adds_and_archives(test_db):
    _tracked(test_db, 1, "a/keep")
    _tracked(test_db, 2, "a/drop")

    result = await sync_starred_repos(
        test_db, FakeGitHub(stars=[_star(1, "a/keep"), _star(3, "a/new")]))

    assert (result.added, result.archived) == (1, 1)
    assert {r.full_name for r in test_db.query(Repo).all()} == {"a/keep", "a/new"}


async def test_added_repo_carries_the_star_date(test_db):
    """starred_at 錯過同步當下就補不回來。"""
    await sync_starred_repos(test_db, FakeGitHub(stars=[_star(1, "a/new")]))

    row = test_db.query(Repo).filter(Repo.full_name == "a/new").one()
    assert row.starred_at == datetime(2026, 8, 10)


async def test_a_second_sync_is_refused_while_one_is_running(test_db, monkeypatch):
    """自動同步與手動同步並行會算出同樣的新增集合，重複 insert 撞 full_name 唯一鍵。"""
    import services.star_sync as mod
    from utils.time import utc_now

    monkeypatch.setattr(mod, "get_setting", _fake_settings({
        AppSettingKey.GITHUB_TOKEN: "gho_fake",
        AppSettingKey.LAST_STAR_SYNC_AT: "2026-08-01T00:00:00Z",
        # 鎖記的是開始時間；剛開始的鎖才算有效（陳舊的鎖見下一條測試）
        AppSettingKey.STAR_SYNC_RUNNING: utc_now().isoformat(),
    }))

    gh = FakeGitHub(stars=[_star(1, "a/one")])
    result = await sync_starred_repos(test_db, gh)

    assert gh.calls == 0
    assert result.skipped_reason == "already_running"


async def test_rename_updates_the_row_instead_of_creating_one(test_db):
    _tracked(test_db, 1, "a/old")

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(1, "a/new")]))

    assert (result.added, result.archived, result.renamed) == (0, 0, 1)
    rows = test_db.query(Repo).all()
    assert len(rows) == 1
    assert (rows[0].full_name, rows[0].name) == ("a/new", "new")


async def test_restarring_an_archived_repo_restores_it_instead_of_inserting(test_db):
    """取本機集合時必須含封存的列。

    不含的話，重新 star 會被判成「新增」而 INSERT，撞上 full_name 唯一鍵回 500——
    而這正是使用者最可能做的事：取消 star 之後又反悔。
    """
    repo = _tracked(test_db, 1, "a/one")
    repo.unstarred_at = datetime(2026, 8, 1)
    test_db.commit()

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(1, "a/one")]))

    assert (result.added, result.restored) == (0, 1)
    from db.soft_delete import include_archived
    rows = include_archived(test_db.query(Repo)).all()
    assert len(rows) == 1, "不得建立第二列"
    assert rows[0].unstarred_at is None


async def test_a_killed_sync_does_not_wedge_every_future_sync(test_db, monkeypatch):
    """行程被殺掉時，鎖不能永久留在 DB 裡。

    sidecar 是 Tauri 的子行程，app 關閉時會被殺。首次同步要跑一段時間，使用者在
    那期間關掉 app 是完全正常的操作——若鎖留著，之後每一次同步都回 already_running，
    而且沒有任何介面能解除。
    """
    import services.star_sync as mod
    from utils.time import utc_now
    from datetime import timedelta

    store = {
        AppSettingKey.GITHUB_TOKEN: "gho_fake",
        AppSettingKey.LAST_STAR_SYNC_AT: "2026-08-01T00:00:00Z",
        # 上一輪在一小時前開始，之後行程被殺，finally 從未執行
        AppSettingKey.STAR_SYNC_RUNNING: (utc_now() - timedelta(hours=1)).isoformat(),
    }
    monkeypatch.setattr(mod, "get_setting", lambda key, db=None: store.get(key))
    monkeypatch.setattr(mod, "set_setting",
                        lambda key, value, db=None: store.__setitem__(key, value))

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(1, "a/one")]))

    assert result.skipped_reason != "already_running", "陳舊的鎖必須被視為未上鎖"
    assert result.added == 1


async def test_a_rename_that_frees_a_name_someone_else_took(test_db):
    """改名與新增撞在同一個名字上時，順序決定會不會整輪失敗。

    真實情境：你追蹤的 repo 改名了，而它原本的名字被另一個你也 star 的 repo 佔走。
    先做新增就會在舊列還持有那個 full_name 時 INSERT，撞上唯一鍵，整輪同步回滾。
    """
    _tracked(test_db, 1, "a/old")

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[
        _star(1, "a/new"),   # 原本那個改名了
        _star(2, "a/old"),   # 另一個 repo 佔走了舊名字
    ]))

    assert result.skipped_reason is None
    names = {r.full_name for r in test_db.query(Repo).all()}
    assert names == {"a/new", "a/old"}


@pytest.mark.asyncio
async def test_truncated_fetch_never_archives(test_db):
    """清單被分頁上限截斷時，缺的那截是「沒看到」不是「已取消 star」。

    第三方審查發現：starred 超過上限時，較舊的 star 會全數落進 diff.archived
    並被非首次同步靜默批次封存。模組守則「資訊不足時不執行移除」必須涵蓋截斷。
    """
    _tracked(test_db, github_id=1, full_name="a/kept")      # 在回傳清單裡
    _tracked(test_db, github_id=2, full_name="a/cut-off")   # 被截斷的那截
    from services.settings import set_setting
    from db.models import AppSettingKey
    set_setting(AppSettingKey.LAST_STAR_SYNC_AT, "2026-01-01T00:00:00Z", test_db)  # 非首次

    result = await sync_starred_repos(
        test_db, FakeGitHub(stars=[_star(1, "a/kept")], truncated=True))

    assert result.archived == 0
    row = test_db.query(Repo).filter(Repo.full_name == "a/cut-off").one()
    assert row.unstarred_at is None, "截斷不得觸發封存"


@pytest.mark.asyncio
async def test_truncated_fetch_still_adds_new_stars(test_db):
    """截斷只該癱瘓「移除」這一翼——新增照常，否則大戶使用者的同步整個失能。"""
    from services.settings import set_setting
    from db.models import AppSettingKey
    set_setting(AppSettingKey.LAST_STAR_SYNC_AT, "2026-01-01T00:00:00Z", test_db)

    result = await sync_starred_repos(
        test_db, FakeGitHub(stars=[_star(9, "a/new")], truncated=True))

    assert result.added == 1


# ── IntegrityError 分流：race 與資料損壞不能同罪 ──────────────


def _commit_raises_after_fetch(db, gh, monkeypatch):
    """讓「fetch 之後的第一次 commit」（即主寫入）拋 IntegrityError。
    鎖的 set_setting commit 發生在 fetch 前（gh.calls == 0），不受影響；
    finally 解鎖的 commit 在 raised 之後，也照常通過。"""
    from sqlalchemy.exc import IntegrityError
    real_commit = db.commit
    state = {"raised": False}

    def failing_commit():
        if gh.calls > 0 and not state["raised"]:
            state["raised"] = True
            raise IntegrityError(
                "INSERT INTO repos", {},
                Exception("UNIQUE constraint failed: repos.full_name"))
        real_commit()

    monkeypatch.setattr(db, "commit", failing_commit)


@pytest.mark.asyncio
async def test_integrity_error_with_added_is_race_lost(test_db, monkeypatch):
    """有新增時撞唯一鍵＝跨行程 race，輸的一方回報 race_lost 而非炸掉。"""
    gh = FakeGitHub(stars=[_star(9, "a/new")])
    _commit_raises_after_fetch(test_db, gh, monkeypatch)

    result = await sync_starred_repos(test_db, gh)

    assert result.skipped_reason == "race_lost"


@pytest.mark.asyncio
async def test_integrity_error_without_added_propagates(test_db, monkeypatch):
    """沒有新增卻撞 IntegrityError＝資料本身違反約束。吞成 race_lost 會讓
    同步從此每輪謊報「對方已完成」且 LAST_STAR_SYNC_AT 永不更新——必須冒出來。"""
    from sqlalchemy.exc import IntegrityError
    _tracked(test_db, 1, "a/one")
    gh = FakeGitHub(stars=[_star(1, "a/one")])  # 與本機一致：diff.added 為空
    _commit_raises_after_fetch(test_db, gh, monkeypatch)

    with pytest.raises(IntegrityError):
        await sync_starred_repos(test_db, gh)
