"""
GET /api/star-history/portfolio 的 stars_gained。

總星數相減會把「清單成員變動」當成成長：新加入一個 8 萬星的 repo，那一天的
「新增星數」就多出 8 萬。stars_gained 只加總相鄰兩個快照日都有資料的 repo。
"""

from datetime import datetime, time, timedelta

from db.models import Repo, RepoSnapshot
from utils.time import utc_now


def _repo(db, name: str) -> Repo:
    repo = Repo(owner="o", name=name, full_name=f"o/{name}", url=f"https://github.com/o/{name}")
    db.add(repo)
    db.flush()
    return repo


def _snap(db, repo: Repo, days_ago: int, stars: int) -> None:
    """App 當天實際抓到的快照：fetched_at 與 snapshot_date 是同一個 UTC 日。"""
    day = utc_now().date() - timedelta(days=days_ago)
    db.add(RepoSnapshot(repo_id=repo.id, stars=stars, snapshot_date=day,
                        fetched_at=datetime.combine(day, time(12))))


def _backfilled(db, repo: Repo, days_ago: int, stars: int) -> None:
    """Star 歷史回填寫進過去日期的快照：fetched_at 是回填當下。"""
    db.add(RepoSnapshot(repo_id=repo.id, stars=stars,
                        snapshot_date=utc_now().date() - timedelta(days=days_ago),
                        fetched_at=utc_now()))


def _history(client) -> list[dict]:
    resp = client.get("/api/star-history/portfolio?days=30")
    assert resp.status_code == 200
    history: list[dict] = resp.json()["data"]["history"]
    return history


def test_a_newly_added_repo_does_not_count_as_growth(client, test_db):
    old = _repo(test_db, "old")
    new = _repo(test_db, "new")
    _snap(test_db, old, 2, 100)
    _snap(test_db, old, 1, 110)
    _snap(test_db, old, 0, 120)
    _snap(test_db, new, 1, 80_000)   # 昨天才加入，本來就有 8 萬星
    _snap(test_db, new, 0, 80_005)
    test_db.commit()

    history = _history(client)

    assert [p["stars_gained"] for p in history] == [None, 10, 15]
    # 圖表標題的「N 個 repo」取最後一個點：要是當天的數量，不是前一天的
    assert [p["repo_count"] for p in history] == [1, 2, 2]
    # 總星數照舊反映清單內容，只是不再拿來當增量
    assert history[1]["total_stars"] == 80_110


def test_a_repo_that_stops_being_tracked_does_not_count_as_loss(client, test_db):
    kept = _repo(test_db, "kept")
    gone = _repo(test_db, "gone")
    _snap(test_db, kept, 1, 100)
    _snap(test_db, kept, 0, 104)
    _snap(test_db, gone, 1, 9_000)   # 今天起沒有快照（取消追蹤後不再抓）
    test_db.commit()

    history = _history(client)

    assert [p["stars_gained"] for p in history] == [None, 4]


def test_gain_spans_a_gap_between_snapshot_days(client, test_db):
    # 中間整天沒有快照（App 與 collector 都沒跑）：增量是兩個快照之間的總和，
    # 攤成日均是前端的事（它知道跨了幾天）
    repo = _repo(test_db, "r")
    _snap(test_db, repo, 3, 100)
    _snap(test_db, repo, 0, 130)
    test_db.commit()

    history = _history(client)

    assert [p["stars_gained"] for p in history] == [None, 30]


def test_backfilled_snapshots_do_not_create_a_sparse_day(client, test_db):
    """回填只在有人 star 的日子寫快照。App 沒開的那天若剛好有人 star 那個 repo，
    那天就只有它一個 repo——拿它跟前後兩天取交集，整個清單的成長會被算成 0，
    而且畫出來是看起來像實測的長條。只算 App 實際觀測到的快照。"""
    repos = [_repo(test_db, n) for n in ("a", "b", "c")]
    for i, repo in enumerate(repos):
        _snap(test_db, repo, 2, 100 * (i + 1))
        _snap(test_db, repo, 0, 100 * (i + 1) + 10)   # 中間那天 App 沒開
    _backfilled(test_db, repos[0], 1, 105)
    test_db.commit()

    history = _history(client)

    assert [p["stars_gained"] for p in history] == [None, 30]
    assert [p["repo_count"] for p in history] == [3, 3]


def test_backfill_correcting_an_observed_snapshot_keeps_it_counted(client, test_db):
    """回填的值是「那天結束時」的累計星數，比當天最後一次抓取大是常態（抓完之後還有人
    star）。覆寫時只修正數值——那一列仍是 App 當天觀測到的，不能因此被當成回填列排除，
    否則那個 repo 在那幾天從清單消失，成長被大幅少算。"""
    from routers.star_history import _create_snapshots_from_history

    a = _repo(test_db, "a")
    b = _repo(test_db, "b")
    for repo in (a, b):
        _snap(test_db, repo, 2, 100)
        _snap(test_db, repo, 1, 110)
        _snap(test_db, repo, 0, 120)
    test_db.commit()

    yesterday = utc_now().date() - timedelta(days=1)
    assert _create_snapshots_from_history(test_db, a.id, {yesterday: 112}) == 1

    history = _history(client)

    assert [p["repo_count"] for p in history] == [2, 2, 2]
    assert [p["stars_gained"] for p in history] == [None, 22, 18]
