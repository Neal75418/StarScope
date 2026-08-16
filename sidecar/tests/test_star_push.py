"""建立 repo 的每一條路徑都必須先 star，且 GitHub 失敗時本機不得改變。

為什麼每一條都要：鏡像模型下，任何一條建立出未 star 的列，下一次同步都會把它
判成「使用者取消了 star」而封存——加進去的東西自己消失。
"""
import pytest

from db.models import Repo
from services.github import GitHubAPIError


class FakeGitHub:
    """記錄呼叫順序，好驗證「先寫 GitHub 才改本機」。"""

    can_write = True

    def __init__(self, fail_star: bool = False):
        self.starred: list[tuple[str, str]] = []
        self.unstarred: list[tuple[str, str]] = []
        self.fail_star = fail_star

    async def star_repo(self, owner: str, name: str) -> None:
        if self.fail_star:
            # 用真實會發生的例外型別：main.py 有對應的處理器，改用 RuntimeError
            # 測到的會是「未處理例外」而不是真實路徑
            raise GitHubAPIError("star failed", status_code=403)
        self.starred.append((owner, name))

    async def unstar_repo(self, owner: str, name: str) -> None:
        self.unstarred.append((owner, name))

    async def get_repo(self, owner: str, name: str) -> dict:
        return {
            "id": abs(hash(f"{owner}/{name}")) % 100000,
            "full_name": f"{owner}/{name}",
            "name": name,
            "owner": {"login": owner},
            "description": None,
            "default_branch": "main",
            "language": "Rust",
            "topics": [],
            "stargazers_count": 1,
            "forks_count": 0,
            "watchers_count": 1,
            "open_issues_count": 0,
            "html_url": f"https://github.com/{owner}/{name}",
            "created_at": "2026-01-01T00:00:00Z",
            "pushed_at": "2026-08-01T00:00:00Z",
        }


@pytest.fixture
def fake_github(monkeypatch):
    gh = FakeGitHub()
    monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)
    return gh


def test_manual_add_stars_on_github(client, test_db, fake_github):
    resp = client.post("/api/repos", json={"owner": "a", "name": "one"})

    assert resp.status_code == 201
    assert fake_github.starred == [("a", "one")]


def test_batch_add_stars_every_repo(client, test_db, fake_github):
    resp = client.post("/api/repos/batch",
                       json={"repos": [{"owner": "a", "name": "one"},
                                       {"owner": "b", "name": "two"}]})

    assert resp.status_code == 200
    assert fake_github.starred == [("a", "one"), ("b", "two")]


def test_local_row_is_not_created_when_the_star_fails(client, test_db, monkeypatch):
    """先寫 GitHub、成功才改本機。

    反過來會在 GitHub 寫入失敗時留下本機已改、遠端未改的狀態——鏡像當場破裂，
    而且沒有任何跡象。
    """
    gh = FakeGitHub(fail_star=True)
    monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)

    resp = client.post("/api/repos", json={"owner": "a", "name": "one"})

    assert resp.status_code == 502
    assert test_db.query(Repo).filter(Repo.full_name == "a/one").first() is None


def test_batch_records_the_failure_without_creating_the_row(client, test_db,
                                                            monkeypatch):
    gh = FakeGitHub(fail_star=True)
    monkeypatch.setattr("routers.repos.get_github_service", lambda: gh)

    resp = client.post("/api/repos/batch",
                       json={"repos": [{"owner": "a", "name": "one"}]})

    data = resp.json()["data"]
    assert data["failed"] == 1
    assert test_db.query(Repo).count() == 0


def test_add_still_works_without_a_token(client, test_db, monkeypatch):
    """star 寫入需要認證，讀取不用。沒有 token 時新增仍該成功。

    不會造成漂移：同步在沒有 token 時同樣不執行；日後連結帳號時那一次是首次同步，
    而首次同步不自動封存，會把這些列出來讓使用者決定。
    """
    class NoToken(FakeGitHub):
        can_write = False

        async def star_repo(self, owner: str, name: str) -> None:
            raise AssertionError("沒有 token 時不該嘗試寫入")

    monkeypatch.setattr("routers.repos.get_github_service", lambda: NoToken())

    resp = client.post("/api/repos", json={"owner": "a", "name": "one"})

    assert resp.status_code == 201
    assert test_db.query(Repo).filter(Repo.full_name == "a/one").first() is not None


def test_adding_an_archived_repo_restores_it(client, test_db, fake_github):
    """取消追蹤過的 repo 必須能再次追蹤。

    封存的列還在（那是刻意的，快照要保留），存在性檢查也看得到它——但那時回 400
    等於告訴使用者「已經在清單裡」，而畫面上根本沒有它。使用者被永久擋住。
    """
    from datetime import datetime

    from db.soft_delete import include_archived

    repo = Repo(owner="a", name="one", full_name="a/one",
                url="https://github.com/a/one", github_id=1,
                unstarred_at=datetime(2026, 8, 16))
    test_db.add(repo)
    test_db.commit()

    resp = client.post("/api/repos", json={"owner": "a", "name": "one"})

    assert resp.status_code == 201
    assert fake_github.starred == [("a", "one")], "復原必須也在 GitHub 上重新 star"
    rows = include_archived(test_db.query(Repo)).all()
    assert len(rows) == 1, "不得建立第二列"
    assert rows[0].unstarred_at is None


def test_adding_records_when_we_starred_it(client, test_db, fake_github):
    """app 內加入時就寫下 star 時間。

    拿不到 GitHub 的精確值（PUT 回 204 空 body），但「剛剛」是夠好的近似，
    下次同步會用 GitHub 的值覆蓋。留 NULL 的話，若使用者馬上又取消追蹤，
    那一列就永遠沒有收藏日期——而那是判斷去留的依據。
    """
    resp = client.post("/api/repos", json={"owner": "a", "name": "one"})

    assert resp.status_code == 201
    row = test_db.query(Repo).filter(Repo.full_name == "a/one").one()
    assert row.starred_at is not None


def test_adding_without_a_token_records_no_star_time(client, test_db, monkeypatch):
    """沒有 token 時我們沒有 star 它，就不該假裝有。"""
    class NoToken(FakeGitHub):
        can_write = False

    monkeypatch.setattr("routers.repos.get_github_service", lambda: NoToken())

    client.post("/api/repos", json={"owner": "a", "name": "one"})

    row = test_db.query(Repo).filter(Repo.full_name == "a/one").one()
    assert row.starred_at is None
