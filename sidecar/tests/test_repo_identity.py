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
