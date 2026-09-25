"""
API 輸出的日期時間一律帶時區。

DB 存 naive UTC；不帶時區的 "2026-09-25T12:00:00" 會被前端 new Date() 當成本地時間
（台灣差 8 小時）。前端的 doFetch 另有補償（src/api/timestamps.ts），但 API 本身與匯出檔
都應該寫清楚。兩道防線：
- 結構：所有 route 的 response model 裡，datetime 欄位都要用 schemas.time.UtcDateTime
  （欄位剛好是 null 時，行為測試看不到）
- 行為：塞好資料後打遍所有 GET endpoint，回應裡不能出現不帶時區的日期時間
  （手寫 isoformat() 的地方，結構測試看不到）
"""

import re
import typing
from datetime import datetime, timedelta

from fastapi.routing import APIRoute
from pydantic import BaseModel, PlainSerializer

from constants import ContextSignalType, EarlySignalSeverity, EarlySignalType
from db.models import AlertRule, Category, ContextSignal, EarlySignal, RepoCategory, TriggeredAlert
from schemas.time import to_utc_iso
from utils.time import utc_now

# 日期＋時間後面沒有 Z 或 ±hh:mm。先吃到最長，lookahead 擋掉「其實後面還有秒／時區」的前綴
NAIVE_DATETIME = re.compile(
    r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?![\d.:]|Z|[+-]\d{2}:?\d{2})"
)
# 回傳的是日誌檔原文（本機時間的純文字），不是 API 的時間欄位
NOT_API_TIMESTAMPS = {"/api/settings/logs"}


def _bare_datetimes(tp: typing.Any, where: str, seen: set) -> list[str]:
    if typing.get_origin(tp) is typing.Annotated:
        base, *meta = typing.get_args(tp)
        if base is datetime and any(
            isinstance(m, PlainSerializer) and m.func is to_utc_iso for m in meta
        ):
            return []
        return _bare_datetimes(base, where, seen)
    if tp is datetime:
        return [where]
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        if tp in seen:
            return []
        seen.add(tp)
        found: list[str] = []
        for name, field in tp.model_fields.items():
            annotation: typing.Any = field.annotation
            if field.metadata:  # `x: UtcDateTime` 的 Annotated metadata 會被 pydantic 拆到這裡
                annotation = typing.Annotated[(annotation, *field.metadata)]
            found += _bare_datetimes(annotation, f"{tp.__name__}.{name}", seen)
        return found
    return [hit for arg in typing.get_args(tp) for hit in _bare_datetimes(arg, where, seen)]


def _response_models():
    import main

    for route in main.app.routes:
        if isinstance(route, APIRoute) and route.response_model is not None:
            yield route, route.response_model


def test_every_response_model_datetime_is_serialised_as_utc():
    offenders = sorted({
        f"{route.path} → {hit}"
        for route, model in _response_models()
        for hit in _bare_datetimes(model, model.__name__ if isinstance(model, type) else str(model), set())
    })
    assert not offenders, f"這些欄位要用 schemas.time.UtcDateTime：{offenders}"


def test_the_scan_catches_a_bare_datetime():
    # 對照組：走訪器若壞掉（例如看不到 Optional 裡面），上一條會空跑變綠
    class Inner(BaseModel):
        at: datetime | None

    class Outer(BaseModel):
        items: list[Inner]

    assert _bare_datetimes(Outer, "Outer", set()) == ["Inner.at"]


def _seed(db, repo):
    now = utc_now()
    db.add_all([
        EarlySignal(repo_id=repo.id, signal_type=EarlySignalType.SUDDEN_SPIKE,
                    severity=EarlySignalSeverity.HIGH, description="d", velocity_value=300.0,
                    baseline_value=40.0, star_count=2500, detected_at=now,
                    expires_at=now + timedelta(days=3)),
        ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.HACKER_NEWS, external_id="1",
                      title="Show HN", url="https://news.ycombinator.com/item?id=1", score=120,
                      published_at=now, fetched_at=now),
        ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.RELEASE, external_id="2",
                      title="v1.0.0", url="https://example.com", tags="security",
                      published_at=now, fetched_at=now),
    ])
    rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=1.0,
                     repo_id=None, enabled=True)
    category = Category(name="tools")
    db.add_all([rule, category])
    db.commit()
    db.add_all([
        TriggeredAlert(rule_id=rule.id, repo_id=repo.id, signal_value=5.0, triggered_at=now),
        RepoCategory(repo_id=repo.id, category_id=category.id),
    ])
    db.commit()
    return {"repo_id": repo.id, "rule_id": rule.id, "category_id": category.id}


def test_no_get_endpoint_returns_an_offset_less_datetime(client, test_db, mock_repo_with_snapshots):
    repo, _ = mock_repo_with_snapshots
    ids = _seed(test_db, repo)
    import main

    naive: list[str] = []
    answered: set[str] = set()
    for route in main.app.routes:
        if not isinstance(route, APIRoute) or "GET" not in route.methods or route.path in NOT_API_TIMESTAMPS:
            continue
        resp = client.get(route.path.format(**ids))
        if resp.status_code != 200:
            continue  # 需要 query 參數、要打 GitHub（測試擋掉網路）的端點
        answered.add(route.path)
        naive += [f"{route.path}: {m.group(0)}" for m in NAIVE_DATETIME.finditer(resp.text)]

    # 前提：真的打到了會輸出時間的端點，不是全部 422／502 之後空跑變綠
    assert {
        "/api/repos", "/api/alerts/triggered", "/api/early-signals/", "/api/context/{repo_id}/signals",
        "/api/summary/weekly", "/api/export/watchlist.json", "/api/health",
    } <= answered
    assert not naive, f"不帶時區的日期時間：{naive}"
