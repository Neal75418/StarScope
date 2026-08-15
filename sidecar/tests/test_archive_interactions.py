"""封存的 repo 不該弄壞既有功能。

每一條都對應一個實測過的失敗，不是推測：

- relationship 載入指向封存 repo 時回 None，而兩處消費端直接當 Repo 使用
  （services/recommender.py 的 find_similar_repos 與 get_personalized_recommendations）
- comparison 把封存成員收進 missing，讓整個請求 404 而不是少一項
- 新增 repo 的存在性檢查看不到封存的列，INSERT 會撞 full_name 唯一鍵回 500
- feed 的已追蹤排除集少了封存的，刻意取消 star 的東西會重新被推薦
"""
from datetime import date, datetime

import pytest

from db.models import Repo, RepoSnapshot, SimilarRepo


@pytest.fixture
def archived_and_live(test_db):
    live = Repo(owner="a", name="live", full_name="a/live",
                url="https://github.com/a/live", github_id=1)
    gone = Repo(owner="a", name="gone", full_name="a/gone",
                url="https://github.com/a/gone", github_id=2,
                unstarred_at=datetime(2026, 8, 16))
    test_db.add_all([live, gone])
    test_db.flush()
    # 相似度計分會讀星數，沒有快照時兩者都拿不到分數
    today = date(2026, 8, 16)
    test_db.add_all([
        RepoSnapshot(repo_id=live.id, stars=100, forks=1, snapshot_date=today),
        RepoSnapshot(repo_id=gone.id, stars=120, forks=2, snapshot_date=today)])
    test_db.commit()
    return live, gone


def test_find_similar_repos_survives_an_archived_target(test_db, archived_and_live):
    """關聯載入回 None——直接當 Repo 用會 AttributeError。"""
    from services.recommender import find_similar_repos

    live, gone = archived_and_live
    test_db.add(SimilarRepo(repo_id=live.id, similar_repo_id=gone.id,
                            similarity_score=0.9))
    test_db.commit()

    results = find_similar_repos(live.id, test_db)

    assert all(r["full_name"] != "a/gone" for r in results)


def test_personalized_recommendations_survive_an_archived_target(test_db,
                                                                 archived_and_live):
    from services.recommender import get_personalized_recommendations

    live, gone = archived_and_live
    test_db.add(SimilarRepo(repo_id=live.id, similar_repo_id=gone.id,
                            similarity_score=0.9))
    test_db.commit()

    result = get_personalized_recommendations(test_db, limit=10)

    assert all(r["full_name"] != "a/gone" for r in result["recommendations"])


def test_comparison_skips_archived_instead_of_404ing_everything(client, test_db,
                                                                archived_and_live):
    """存好的比較組合裡有人被取消 star 時，整頁不該壞掉。"""
    live, gone = archived_and_live
    resp = client.post("/api/comparison/chart",
                       json={"repo_ids": [live.id, gone.id]})

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [r["repo_name"] for r in data["repos"]] == ["a/live"]
    assert data["skipped_archived"] == [gone.id]


def test_adding_an_archived_repo_restores_the_same_row(client, test_db,
                                                       archived_and_live, monkeypatch):
    """存在性檢查必須看得到封存的列。

    看不到的話會一路往下 INSERT，撞上 full_name 唯一鍵回 500。看得到之後的行為是
    「復原」而不是報錯——封存的列代表使用者取消過又反悔，回 400 說「已經在清單裡」
    會讓他被永久擋住，因為畫面上根本沒有那一列。
    """
    from db.soft_delete import include_archived
    from tests.test_star_push import FakeGitHub

    monkeypatch.setattr("routers.repos.get_github_service", lambda: FakeGitHub())

    resp = client.post("/api/repos", json={"owner": "a", "name": "gone"})

    assert resp.status_code == 201
    rows = include_archived(test_db.query(Repo)).filter(Repo.full_name == "a/gone").all()
    assert len(rows) == 1, "不得建立第二列"
    assert rows[0].unstarred_at is None


def test_feed_does_not_recommend_an_archived_repo(test_db, archived_and_live):
    """刻意取消 star 的東西不該下週又被推薦。

    SeenRepo 擋不住這種：當初從 star 匯入、未經 feed 的那些沒有 SeenRepo 記錄。
    """
    from services.feed_generator import collect_watchlist_keys

    ids, names = collect_watchlist_keys(test_db)

    assert 2 in ids
    assert "a/gone" in names


# --- 滲漏掃描 ---


LISTING_ENDPOINTS = [
    "/api/repos",
    "/api/export/watchlist.json",
    "/api/export/watchlist.csv",
    "/api/trends",
]


@pytest.mark.parametrize("endpoint", LISTING_ENDPOINTS)
def test_archived_repo_does_not_leak_into_any_listing(client, archived_and_live, endpoint):
    """封存的 repo 不得從任何列出 repo 的端點滲出來。

    這一條掃的是「預設排除」這個機制本身。個別端點的作者不需要記得加條件，
    但如果哪天有人在某支端點用了 include_archived 又忘了濾回來，這裡會抓到。
    """
    resp = client.get(endpoint)

    assert resp.status_code == 200
    assert "a/gone" not in resp.text, f"{endpoint} 洩漏了封存的 repo"
    assert "a/live" in resp.text, f"{endpoint} 連未封存的都沒回，測試本身可能沒生效"
