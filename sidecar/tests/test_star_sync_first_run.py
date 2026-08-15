"""首次同步的差異是歷史遺留，不是使用者的決定。

之後的差異才代表「使用者取消了 star」。用同一套邏輯處理，會把 app 用了七個月
累積下來、從未推上 GitHub 的那些 repo 當成使用者剛剛決定不要的。
"""
from datetime import datetime

import pytest

from db.models import AppSettingKey, Repo
from services.star_sync import sync_starred_repos
from tests.test_star_sync_service import FakeGitHub, _star, _tracked


@pytest.fixture(autouse=True)
def _has_token_but_never_synced(monkeypatch):
    """有 token，但 LAST_STAR_SYNC_AT 從未寫入——即首次同步。"""
    import services.star_sync as mod

    store: dict[str, str] = {AppSettingKey.GITHUB_TOKEN: "gho_fake"}

    def _get(key, db=None):
        return store.get(key)

    def _set(key, value, db=None):
        store[key] = value

    monkeypatch.setattr(mod, "get_setting", _get)
    monkeypatch.setattr(mod, "set_setting", _set)
    return store


async def test_first_sync_lists_local_only_repos_instead_of_archiving_them(test_db):
    _tracked(test_db, 1, "a/local-only")

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(2, "a/remote")]))

    assert result.archived == 0
    assert result.pending_local_only == ["a/local-only"]
    row = test_db.query(Repo).filter(Repo.full_name == "a/local-only").first()
    assert row is not None and row.unstarred_at is None


async def test_first_sync_still_adds_what_is_new(test_db):
    """不封存是唯一的差別；新增照常。"""
    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(2, "a/remote")]))

    assert result.added == 1
    assert test_db.query(Repo).filter(Repo.full_name == "a/remote").first() is not None


async def test_second_sync_does_archive(test_db):
    """第二次之後，差異就代表使用者的決定了。"""
    _tracked(test_db, 1, "a/local-only")
    await sync_starred_repos(test_db, FakeGitHub(stars=[_star(2, "a/remote")]))

    result = await sync_starred_repos(test_db, FakeGitHub(stars=[_star(2, "a/remote")]))

    assert result.archived == 1
    assert result.pending_local_only == []
    row = test_db.query(Repo).filter(Repo.full_name == "a/local-only").first()
    assert row is None, "第二次同步後應已封存"


def test_resolve_archives_the_named_repos(client, test_db):
    from db.soft_delete import include_archived

    _tracked(test_db, 1, "a/local-only")

    resp = client.post("/api/repos/sync/resolve",
                       json={"action": "archive", "full_names": ["a/local-only"]})

    assert resp.status_code == 200
    assert resp.json()["data"]["handled"] == 1
    row = include_archived(test_db.query(Repo)).filter(
        Repo.full_name == "a/local-only").one()
    assert row.unstarred_at is not None


def test_resolve_rejects_an_unknown_action(client, test_db):
    resp = client.post("/api/repos/sync/resolve",
                       json={"action": "delete", "full_names": ["a/local-only"]})

    assert resp.status_code == 422


def test_resolve_star_pushes_to_github_and_keeps_the_repo(client, test_db, monkeypatch):
    """推上去這條路徑必須真的寫 GitHub，否則下一次同步又會把它列出來。"""
    from tests.test_star_push import FakeGitHub

    gh = FakeGitHub()
    monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)
    _tracked(test_db, 1, "a/local-only")

    resp = client.post("/api/repos/sync/resolve",
                       json={"action": "star", "full_names": ["a/local-only"]})

    assert resp.status_code == 200
    assert gh.starred == [("a", "local-only")]
    assert test_db.query(Repo).filter(Repo.full_name == "a/local-only").first() is not None
