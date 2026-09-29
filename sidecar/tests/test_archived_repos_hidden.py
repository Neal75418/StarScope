"""已封存的 repo 在一般畫面上視為不存在，跟它有關的資料保留、復原後原封不動地回來。

封存靠 db/soft_delete.py 的全域過濾：所有 SELECT 預設排除 unstarred_at 有值的 repo。
副作用是別張表指向封存 repo 的關聯會載入成 None，查詢沒有連同 Repo 一起查的地方，
要嘛把封存 repo 的資料漏出來或算進數字，要嘛拿 None 當物件用而整頁 500（分類篩選、已觸發警報都發生過）。
這裡建一個在每張指向 repos 的表都有資料的 repo、用正式的 API 封存，再檢查每個 GET 端點。
"""
import re
from datetime import timedelta
from typing import Any

import pytest
from fastapi.routing import APIRoute, iter_route_contexts

from constants import ContextSignalType, EarlySignalSeverity, EarlySignalType, SignalType
from db.models import (
    AlertRule, Category, ContextSignal, EarlySignal, Repo, RepoCategory, RepoSnapshot, Signal,
    SimilarRepo, TriggeredAlert,
)
from utils.time import utc_now

ARCHIVED_NAME = "gone-owner/gone-repo"
# 本來就是列出封存 repo 的端點
LISTS_ARCHIVED = {"/api/repos/archived"}
# 封存前後回應會變的端點（用 kept 那組參數看）。兩個方向都檢查：少了＝資料集不再涵蓋它，
# 下面的不變式對它空跑；多了＝有新端點讀到 repo 資料，確認它該跟著封存變再加進來
CHANGES_WHEN_ARCHIVED = {
    "/api/repos", "/api/repos/archived", "/api/categories/tree", "/api/categories/{category_id}",
    "/api/categories/{category_id}/repos", "/api/alerts/triggered", "/api/alerts/rules",
    "/api/summary/weekly", "/api/star-history/portfolio", "/api/early-signals/",
    "/api/early-signals/summary", "/api/trends/", "/api/digest", "/api/recommendations/personalized",
    "/api/settings/diagnostics", "/api/export/watchlist.csv", "/api/export/watchlist.json",
    "/api/export/trends.csv", "/api/export/trends.json",
}
_ISO_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?")


def _repo(db, owner: str, name: str, github_id: int) -> Repo:
    repo = Repo(owner=owner, name=name, full_name=f"{owner}/{name}",
                url=f"https://github.com/{owner}/{name}", github_id=github_id,
                description=f"{name} description", language="Rust")
    db.add(repo)
    db.commit()
    return repo


def _fill(db, repo: Repo, days: int, signal_types: dict[SignalType, float]) -> None:
    """快照、指標、HN 與 release 訊號、早期訊號：每張只屬於這個 repo 的表各一筆以上。"""
    now = utc_now()
    today = now.date()
    db.add_all(
        [RepoSnapshot(repo_id=repo.id, stars=1000 + i * 40, forks=10, watchers=5, open_issues=1,
                      snapshot_date=today - timedelta(days=i), fetched_at=now - timedelta(days=i))
         for i in range(days)]
        + [Signal(repo_id=repo.id, signal_type=t, value=v, calculated_at=now) for t, v in signal_types.items()]
        + [
            ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.HACKER_NEWS,
                          external_id=f"hn-{repo.id}", title=f"Show HN {repo.name}",
                          url=f"https://news.ycombinator.com/item?id={repo.id}", score=150,
                          published_at=now, fetched_at=now),
            ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.RELEASE,
                          external_id=f"rel-{repo.id}", title=f"{repo.name} v1.0.0",
                          url=f"https://github.com/{repo.full_name}/releases/v1.0.0",
                          tags="security", published_at=now, fetched_at=now),
            EarlySignal(repo_id=repo.id, signal_type=EarlySignalType.SUDDEN_SPIKE,
                        severity=EarlySignalSeverity.HIGH, description=f"{repo.name} spiked",
                        velocity_value=300.0, baseline_value=40.0, star_count=1400,
                        detected_at=now, expires_at=now + timedelta(days=3)),
        ])
    db.commit()


@pytest.fixture
def world(test_db):
    """一個照常追蹤的 repo、一個在每張指向 repos 的表都有資料的 repo（還沒封存）。

    兩個 repo 刻意不對稱：只有 gone 有比較舊的快照與 30 天增量。對稱的資料集抓不到
    min／exists 型的滲漏（「最早的快照」「有沒有這種訊號」），因為 kept 自己就撐起同一個答案。
    """
    kept = _repo(test_db, "kept-owner", "kept-repo", 880001)
    gone = _repo(test_db, "gone-owner", "gone-repo", 880002)
    common = {SignalType.VELOCITY: 40.0, SignalType.STARS_DELTA_7D: 280.0,
              SignalType.ACCELERATION: 2.0, SignalType.TREND: 1.0}
    _fill(test_db, kept, days=10, signal_types=common)
    _fill(test_db, gone, days=45, signal_types={**common, SignalType.STARS_DELTA_30D: 400.0})
    shared = Category(name="Shared")
    only_gone = Category(name="Only gone")
    global_rule = AlertRule(name="any repo fast", signal_type="velocity", operator=">",
                            threshold=1.0, repo_id=None, enabled=True)
    gone_rule = AlertRule(name="gone repo fast", signal_type="velocity", operator=">",
                          threshold=1.0, repo_id=gone.id, enabled=True)
    test_db.add_all([shared, only_gone, global_rule, gone_rule])
    test_db.commit()
    now = utc_now()
    test_db.add_all([
        RepoCategory(repo_id=kept.id, category_id=shared.id),
        RepoCategory(repo_id=gone.id, category_id=shared.id),
        RepoCategory(repo_id=gone.id, category_id=only_gone.id),
        TriggeredAlert(rule_id=global_rule.id, repo_id=kept.id, signal_value=40.0, triggered_at=now),
        TriggeredAlert(rule_id=global_rule.id, repo_id=gone.id, signal_value=40.0, triggered_at=now),
        TriggeredAlert(rule_id=gone_rule.id, repo_id=gone.id, signal_value=40.0, triggered_at=now),
        SimilarRepo(repo_id=kept.id, similar_repo_id=gone.id, similarity_score=0.9,
                    shared_topics='["rust"]', same_language=True),
        SimilarRepo(repo_id=gone.id, similar_repo_id=kept.id, similarity_score=0.9,
                    shared_topics='["rust"]', same_language=True),
    ])
    test_db.commit()
    return {"kept": kept.id, "gone": gone.id, "shared": shared.id, "only_gone": only_gone.id,
            "global_rule": global_rule.id, "gone_rule": gone_rule.id}


def _archive(client, world) -> None:
    assert client.post(f"/api/repos/{world['gone']}/unstar").status_code == 200


def _params(world, which: str) -> dict[str, int]:
    """路徑參數：kept 那組看一般畫面；gone 那組看直接拿封存 repo 的 id 去查會怎樣。"""
    if which == "kept":
        return {"repo_id": world["kept"], "rule_id": world["global_rule"], "category_id": world["shared"]}
    return {"repo_id": world["gone"], "rule_id": world["gone_rule"], "category_id": world["only_gone"]}


def _get(client, test_db, path: str):
    # 正式環境每個請求都是新的 session；測試共用一個，上一個請求載入的關聯（包括 None）會留著
    test_db.expire_all()
    return client.get(path)


def _get_routes() -> list[str]:
    import main

    return [ctx.path for ctx in iter_route_contexts(main.app.routes)
            if isinstance(ctx.original_route, APIRoute) and "GET" in ctx.methods]


def _normalize(path: str, body: Any) -> str:
    if isinstance(body, dict) and isinstance(body.get("data"), dict):
        data = body["data"]
        if path == "/api/digest":
            # 游標是三張表目前的最大 id（不 join repo，包含封存 repo 的列），永久刪除刪到最大 id 時
            # 就會下降。它是水位線不是內容，摘要的項目本身照樣比對
            data.pop("cursor", None)
        if path == "/api/settings/diagnostics":
            # 快照數量跟旁邊的 DB 大小一樣是儲存量指標：封存就是把資料留在資料庫裡，刻意照算
            # （Repos 那格是追蹤中的數量，跟清單對得上）；uptime 每次呼叫都不同
            data.pop("total_snapshots", None)
            data.pop("uptime_seconds", None)
    # 回應裡「現在」的時間戳記兩次呼叫一定不同，跟封存無關
    return _ISO_TIMESTAMP.sub("<ts>", str(body))


def _snapshot_every_get(client, test_db, params: dict[str, int]) -> dict[str, str]:
    out = {}
    for path in _get_routes():
        resp = _get(client, test_db, path.format(**params))
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        out[path] = f"{resp.status_code} {_normalize(path, body)}"
    return out


@pytest.mark.parametrize("which", ["kept", "gone"])
def test_no_get_endpoint_breaks_or_leaks_an_archived_repo(client, test_db, world, which):
    _archive(client, world)
    broken, leaked, answered = [], [], set()
    for path in _get_routes():
        resp = _get(client, test_db, path.format(**_params(world, which)))
        if resp.status_code >= 500:
            broken.append(f"{path} → {resp.status_code}")
            continue
        if resp.status_code == 200:
            answered.add(path)
        if path not in LISTS_ARCHIVED and re.search(re.escape(ARCHIVED_NAME), resp.text):
            leaked.append(path)

    assert not broken, f"封存一個 repo 之後這些端點壞了：{broken}"
    assert not leaked, f"這些端點漏出了封存的 repo：{leaked}"
    # 前提：真的打到了會列出 repo 的端點，不是全部 404／422 之後空跑變綠
    assert {"/api/repos", "/api/categories/{category_id}/repos", "/api/alerts/triggered",
            "/api/alerts/rules", "/api/early-signals/", "/api/repos/archived"} <= answered


def test_an_archived_repo_looks_exactly_like_a_deleted_one(client, test_db, world):
    # 比名稱更嚴格：數字也不能把它算進去（週報的新增 star 總數、Portfolio History 的加總……），
    # 而那種滲漏在回應裡找不到它的名字。永久刪除後它的資料全部消失（FK cascade），
    # 所以封存當下每個 GET 回應都該跟刪除之後一模一樣——用一般畫面的 id 看、用它自己的 id 查都一樣
    before = _snapshot_every_get(client, test_db, _params(world, "kept"))
    _archive(client, world)
    archived = {which: _snapshot_every_get(client, test_db, _params(world, which)) for which in ("kept", "gone")}

    assert client.delete(f"/api/repos/{world['gone']}").status_code == 204
    # 前提：刪除真的帶走了它的所有資料。有些表只靠 ON DELETE CASCADE，測試 engine 沒開 foreign_keys 的話
    # 它們會留下來，「刪除後」就不是乾淨的對照組，這條測試會對那些表失明
    test_db.expire_all()
    gone = world["gone"]
    leftovers = {
        model.__name__: count
        for model, column in ((RepoSnapshot, RepoSnapshot.repo_id), (Signal, Signal.repo_id),
                              (AlertRule, AlertRule.repo_id), (TriggeredAlert, TriggeredAlert.repo_id),
                              (ContextSignal, ContextSignal.repo_id), (EarlySignal, EarlySignal.repo_id),
                              (RepoCategory, RepoCategory.repo_id), (SimilarRepo, SimilarRepo.repo_id),
                              (SimilarRepo, SimilarRepo.similar_repo_id))
        if (count := test_db.query(model).filter(column == gone).count())
    }
    assert not leftovers, f"永久刪除後仍有資料指向它：{leftovers}"
    deleted = {which: _snapshot_every_get(client, test_db, _params(world, which)) for which in ("kept", "gone")}

    # 前提：資料集真的讓這些端點在封存前後不同，不變式對它們才不是空跑
    changed = {path for path in before if before[path] != archived["kept"][path]}
    assert not CHANGES_WHEN_ARCHIVED - changed, f"封存前後沒有變化（資料集沒涵蓋到）：{CHANGES_WHEN_ARCHIVED - changed}"
    assert not changed - CHANGES_WHEN_ARCHIVED, f"封存前後有變化但不在清單（新端點？確認它該跟著封存變再加進來）：{changed - CHANGES_WHEN_ARCHIVED}"
    differs = sorted(
        f"{path}（用 {which} 的 id）"
        for which in ("kept", "gone")
        for path in archived[which]
        if archived[which][path] != deleted[which][path] and path not in LISTS_ARCHIVED
    )
    assert not differs, f"封存與永久刪除的回應不同（封存的 repo 被看見或被算進去）：{differs}"


def test_categories_hide_archived_members_and_get_them_back_on_restore(client, test_db, world):
    def members(category_id: int) -> list[int]:
        resp = _get(client, test_db, f"/api/categories/{category_id}/repos")
        assert resp.status_code == 200
        body = resp.json()["data"]
        assert body["total"] == len(body["repos"])
        return sorted(r["id"] for r in body["repos"])

    def counts() -> dict[str, int]:
        tree = _get(client, test_db, "/api/categories/tree").json()["data"]["tree"]
        return {node["name"]: node["repo_count"] for node in tree}

    _archive(client, world)
    assert members(world["shared"]) == [world["kept"]]
    assert members(world["only_gone"]) == []
    assert counts() == {"Shared": 1, "Only gone": 0}

    assert client.post(f"/api/repos/{world['gone']}/restar").status_code == 200

    assert members(world["shared"]) == sorted([world["kept"], world["gone"]])
    assert members(world["only_gone"]) == [world["gone"]]
    assert counts() == {"Shared": 2, "Only gone": 1}


def test_alerts_hide_the_archived_repo_and_get_it_back_on_restore(client, test_db, world):
    def triggered_repos() -> list[int]:
        resp = _get(client, test_db, "/api/alerts/triggered")
        assert resp.status_code == 200
        return sorted(a["repo_id"] for a in resp.json()["data"])

    def rule_ids() -> list[int]:
        resp = _get(client, test_db, "/api/alerts/rules")
        assert resp.status_code == 200
        return sorted(r["id"] for r in resp.json()["data"])

    _archive(client, world)
    # 綁在封存 repo 上的規則不會再被檢查（check_all_alerts 看不到那個 repo）：
    # 顯示出來只會被當成「所有 repo」的規則
    assert triggered_repos() == [world["kept"]]
    assert rule_ids() == [world["global_rule"]]
    rule_url = f"/api/alerts/rules/{world['gone_rule']}"
    assert _get(client, test_db, rule_url).status_code == 404
    # 改、刪也當它不存在，而且回 404 的請求不能留下任何寫入
    assert client.patch(rule_url, json={"enabled": False}).status_code == 404
    assert client.delete(rule_url).status_code == 404

    assert client.post(f"/api/repos/{world['gone']}/restar").status_code == 200

    assert triggered_repos() == sorted([world["kept"], world["gone"], world["gone"]])
    assert rule_ids() == sorted([world["global_rule"], world["gone_rule"]])
    rule = _get(client, test_db, rule_url)
    assert rule.status_code == 200
    assert rule.json()["data"]["enabled"] is True
