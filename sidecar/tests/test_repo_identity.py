"""抓取時的身分驗證。

repo 名稱不是穩定的識別碼——它會改名，而舊名字可能被別人佔走。抓取卻是用
owner/name 查的，所以必須驗證回來的東西真的是同一個 repo。

兩個情境都有真實對應：GitHub 對改名的 repo 回 301（實測 facebook/react →
/repositories/10270250），而熱門專案的舊名被搶註冊是常見的事。
"""
from datetime import date

from db.models import Repo, RepoSnapshot
from services.snapshot import update_repo_from_github


def _tracked(db) -> Repo:
    repo = Repo(owner="a", name="old", full_name="a/old",
                url="https://github.com/a/old", github_id=111,
                description="the real one", language="Rust")
    db.add(repo)
    db.flush()
    db.add(RepoSnapshot(repo_id=repo.id, stars=100, forks=1,
                        snapshot_date=date(2026, 8, 16)))
    db.commit()
    return repo


def test_a_different_repo_under_the_old_name_is_refused(test_db):
    """舊名被別人佔走時，那個人的資料不得覆蓋你的列。"""
    repo = _tracked(test_db)

    update_repo_from_github(repo, {
        "id": 999,                      # ← 完全不同的 repo
        "full_name": "a/old",
        "description": "an impostor",
        "language": "PHP",
        "stargazers_count": 3,
    }, test_db)
    test_db.commit()

    assert repo.description == "the real one", "別人的資料不得寫進來"
    assert repo.language == "Rust"


def test_a_renamed_repo_updates_its_stored_name(test_db):
    """id 相同就是同一個 repo，改名要跟著更新——否則下次還是用舊名去查。"""
    repo = _tracked(test_db)

    update_repo_from_github(repo, {
        "id": 111,
        "full_name": "a/new",
        "name": "new",
        "owner": {"login": "a"},
        "description": "renamed",
        "language": "Rust",
        "stargazers_count": 120,
    }, test_db)
    test_db.commit()

    assert repo.full_name == "a/new"
    assert repo.name == "new"
    assert repo.description == "renamed"


def test_adding_by_an_old_name_stores_the_current_one(test_db):
    """用舊名新增改名過的 repo，存下來的必須是現在的名字。

    請求被 301 導向到新位置後，回應描述的是新名字。若沿用輸入的字串，那一列會
    帶著一個已經不存在的名字，之後每次抓取都得靠導向撐著——而舊名總有一天會
    被別人佔走。
    """
    from routers.repos import _create_repo_from_github

    repo = _create_repo_from_github("a", "old", {
        "id": 111,
        "full_name": "a/new",
        "name": "new",
        "owner": {"login": "a"},
        "description": "moved",
    })

    assert repo.full_name == "a/new"
    assert repo.owner == "a"
    assert repo.name == "new"
    assert repo.url == "https://github.com/a/new"


def _renamed_to(name: str, stars: int = 120) -> dict:
    owner, short = name.split("/")
    return {"id": 111, "full_name": name, "name": short, "owner": {"login": owner},
            "description": "renamed", "language": "Rust", "stargazers_count": stars}


def test_a_rename_into_a_name_another_row_holds_still_updates_the_data(test_db):
    """舊版本留下的重複列：同一個 github_id 一列舊名、一列已經是新名。改名撞 full_name 唯一鍵的話，
    手動抓取回 500、排程每一輪都算這一列失敗；改名先跳過，資料照樣更新"""
    from utils.time import utc_today

    repo = _tracked(test_db)
    test_db.add(Repo(owner="a", name="new", full_name="a/new", url="https://github.com/a/new", github_id=111))
    test_db.commit()

    update_repo_from_github(repo, _renamed_to("a/new"), test_db)

    test_db.expire_all()
    assert repo.full_name == "a/old"
    assert repo.description == "renamed"
    today = test_db.query(RepoSnapshot).filter_by(repo_id=repo.id, snapshot_date=utc_today()).one()
    assert today.stars == 120


def test_a_rename_updates_the_link_too(test_db):
    repo = _tracked(test_db)

    update_repo_from_github(repo, _renamed_to("a/new"), test_db)

    assert repo.url == "https://github.com/a/new"


def test_a_missing_github_id_is_filled_in(test_db):
    """沒有 github_id 的舊列：補上之後，加入與同步才認得出它（改名後用新名加入、id 比對）"""
    repo = _tracked(test_db)
    repo.github_id = None
    test_db.commit()

    update_repo_from_github(repo, _renamed_to("a/old"), test_db)

    test_db.expire_all()
    assert repo.github_id == 111


def test_a_manual_fetch_does_not_fail_on_a_held_name(client, test_db):
    """手動抓取（卡片上的抓取）原本在這裡撞唯一鍵回 500"""
    from unittest.mock import AsyncMock, patch

    repo = _tracked(test_db)
    test_db.add(Repo(owner="a", name="new", full_name="a/new", url="https://github.com/a/new", github_id=111))
    test_db.commit()
    github = AsyncMock()
    github.get_repo.return_value = {**_renamed_to("a/new"), "forks_count": 0, "open_issues_count": 0}
    with patch("routers.repos.get_github_service", return_value=github):
        response = client.post(f"/api/repos/{repo.id}/fetch")

    assert response.status_code == 200

