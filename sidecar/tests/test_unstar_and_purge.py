"""取消追蹤保留資料；永久刪除是另一個明確的動作。

兩者分開的理由：取消追蹤會頻繁發生（年度清理一次可能十幾個），永久刪除會 cascade
掉快照、訊號與警示規則且不可復原。把不可逆的操作放在一個需要刻意前往的位置。
"""
from datetime import date

import pytest

from db.models import Repo, RepoSnapshot
from db.soft_delete import include_archived
from tests.test_star_push import FakeGitHub


@pytest.fixture
def fake_github(monkeypatch):
    gh = FakeGitHub()
    monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)
    return gh


def _tracked(db) -> Repo:
    repo = Repo(owner="a", name="one", full_name="a/one",
                url="https://github.com/a/one", github_id=1)
    db.add(repo)
    db.flush()
    db.add(RepoSnapshot(repo_id=repo.id, stars=10, forks=1,
                        snapshot_date=date(2026, 8, 16)))
    db.commit()
    return repo


def test_unstar_archives_and_keeps_snapshots(client, test_db, fake_github):
    repo = _tracked(test_db)

    resp = client.post(f"/api/repos/{repo.id}/unstar")

    assert resp.status_code == 200
    assert fake_github.unstarred == [("a", "one")]
    assert test_db.query(RepoSnapshot).count() == 1, "取消追蹤不得刪除任何快照"
    assert test_db.query(Repo).count() == 0, "封存後不該出現在一般清單"


def test_unstar_leaves_local_untouched_when_github_fails(client, test_db, monkeypatch):
    """與新增同一個原則：先寫 GitHub，成功才改本機。"""
    from services.github import GitHubAPIError

    repo = _tracked(test_db)

    class Failing(FakeGitHub):
        async def unstar_repo(self, owner: str, name: str) -> None:
            raise GitHubAPIError("unstar failed", status_code=403)

    monkeypatch.setattr("routers.repos.get_github_service", lambda: Failing())

    resp = client.post(f"/api/repos/{repo.id}/unstar")

    assert resp.status_code == 502
    assert include_archived(test_db.query(Repo)).one().unstarred_at is None


def test_archived_list_shows_it_and_restar_brings_it_back(client, test_db, fake_github):
    repo = _tracked(test_db)
    client.post(f"/api/repos/{repo.id}/unstar")

    listed = client.get("/api/repos/archived").json()["data"]["repos"]
    assert [r["full_name"] for r in listed] == ["a/one"]

    assert client.post(f"/api/repos/{repo.id}/restar").status_code == 200
    assert fake_github.starred == [("a", "one")]
    assert test_db.query(Repo).count() == 1


def test_permanent_delete_refuses_a_repo_that_is_still_tracked(client, test_db):
    """不可逆的操作只能從封存清單發動，不能是追蹤清單上的一次誤點。"""
    repo = _tracked(test_db)

    assert client.delete(f"/api/repos/{repo.id}").status_code == 400
    assert test_db.query(Repo).count() == 1


def test_permanent_delete_removes_an_archived_repo_and_its_snapshots(client, test_db,
                                                                     fake_github):
    repo = _tracked(test_db)
    client.post(f"/api/repos/{repo.id}/unstar")

    assert client.delete(f"/api/repos/{repo.id}").status_code == 204
    assert include_archived(test_db.query(Repo)).count() == 0
    assert test_db.query(RepoSnapshot).count() == 0
