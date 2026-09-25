"""「自上次以來」摘要：追蹤清單裡的 repo 自上次看過之後發生了什麼。

「新」以資料列 id 判定，不用時間：release 與 HN 是 upsert，重抓會刷新 fetched_at；
published_at 又可能早於 StarScope 得知的時間（離線三天後才抓到四天前的 release）。
id 只有真的新增時才會變大。設計見 docs/superpowers/specs/2026-09-25-since-last-visit-digest-design.md
"""

import json
import logging
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from constants import (
    DIGEST_HIGHLIGHT_RELEASE_TAGS,
    DIGEST_HIGHLIGHT_SEVERITIES,
    DIGEST_HN_HIGHLIGHT_MIN_SCORE,
    DIGEST_INITIAL_WINDOW_DAYS,
    DIGEST_OTHER_LIMIT,
    ContextSignalType,
    EarlySignalType,
)
from db.models import AlertRule, AppSettingKey, ContextSignal, EarlySignal, Repo, TriggeredAlert
from services.settings import delete_setting, get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 游標是讀-改-寫：兩支 POST 在 threadpool 裡並行時會讀到同一個舊值（後寫的蓋掉先寫的），
# 第一次寫入時則是其中一個撞 UNIQUE。只有 app 的 sidecar 會寫游標，行程內互斥就夠
_cursor_write_lock = threading.Lock()


@dataclass(frozen=True)
class DigestCursor:
    """三張來源表各自看過的最大 id。"""

    context_signal_id: int
    early_signal_id: int
    triggered_alert_id: int

    def merged(self, other: "DigestCursor") -> "DigestCursor":
        return DigestCursor(
            context_signal_id=max(self.context_signal_id, other.context_signal_id),
            early_signal_id=max(self.early_signal_id, other.early_signal_id),
            triggered_alert_id=max(self.triggered_alert_id, other.triggered_alert_id),
        )


def load_cursor(db: Session) -> tuple[DigestCursor | None, datetime | None]:
    """讀游標與上次看過的時間；沒有或格式壞掉時回 (None, None)，視為第一次使用。"""
    raw = get_setting(AppSettingKey.DIGEST_CURSOR, db)
    if raw is None:
        return None, None
    try:
        data = json.loads(raw)
        cursor = DigestCursor(
            context_signal_id=int(data["context_signal_id"]),
            early_signal_id=int(data["early_signal_id"]),
            triggered_alert_id=int(data["triggered_alert_id"]),
        )
        seen_at = datetime.fromisoformat(data["seen_at"]) if data.get("seen_at") else None
    except (ValueError, KeyError, TypeError):
        logger.warning("[摘要] 游標格式錯誤，視為第一次使用：%r", raw)
        return None, None
    return cursor, seen_at


def save_cursor(cursor: DigestCursor, db: Session) -> DigestCursor:
    """逐欄取 max 後寫回，回傳實際寫入的游標。重送舊的 cursor 不會讓游標倒退。"""
    with _cursor_write_lock:
        current, _ = load_cursor(db)
        merged = cursor if current is None else current.merged(cursor)
        set_setting(
            AppSettingKey.DIGEST_CURSOR,
            json.dumps({**asdict(merged), "seen_at": utc_now().isoformat()}),
            db,
        )
        return merged


def clear_cursor(db: Session) -> None:
    delete_setting(AppSettingKey.DIGEST_CURSOR, db)


def lower_cursor_to_existing(db: Session) -> None:
    """刪除這三張表之後呼叫（在呼叫端 commit 之後）：把存著的游標壓到各表目前的最大 id。

    三張表沒有 AUTOINCREMENT，最大的那幾列被刪掉之後新列會重用 id；游標若還停在被刪掉的
    id，重用那些 id 的新列會被當成看過——被漏掉的往往是重點（刪一條警報規則就可能清空
    triggered_alerts）。壓到現有最大 id 之後新列一定比游標大；已看過的列都 ≤ 最大 id，不會復活。
    seen_at 不變：這不是使用者看過。
    """
    with _cursor_write_lock:
        current, seen_at = load_cursor(db)
        if current is None:
            return
        lowered = clamp_to_existing(current, db)
        if lowered == current:
            return
        set_setting(
            AppSettingKey.DIGEST_CURSOR,
            json.dumps({**asdict(lowered), "seen_at": seen_at.isoformat() if seen_at else None}),
            db,
        )


def clamp_to_existing(cursor: DigestCursor, db: Session) -> DigestCursor:
    """前端送來的 cursor 不可能超過各表目前的最大 id；超過的是送錯或 reset 前的舊值。

    不擋的話，大到超出 SQLite INTEGER 的值會讓之後每次 GET 都 500，
    合法但過大的值則讓摘要一直空到 id 追上它。
    """
    ceiling = _current_max_ids(db)
    return DigestCursor(
        context_signal_id=min(cursor.context_signal_id, ceiling.context_signal_id),
        early_signal_id=min(cursor.early_signal_id, ceiling.early_signal_id),
        triggered_alert_id=min(cursor.triggered_alert_id, ceiling.triggered_alert_id),
    )


def _iso_utc(dt: datetime) -> str:
    # DB 存 naive UTC；不帶時區的字串會被前端 new Date() 當成本地時間
    return dt.replace(tzinfo=timezone.utc).isoformat()


def _repo_ref(repo: Repo) -> dict[str, Any]:
    return {"id": repo.id, "full_name": repo.full_name, "url": repo.url}


def _current_max_ids(db: Session) -> DigestCursor:
    return DigestCursor(
        context_signal_id=db.query(func.max(ContextSignal.id)).scalar() or 0,
        early_signal_id=db.query(func.max(EarlySignal.id)).scalar() or 0,
        triggered_alert_id=db.query(func.max(TriggeredAlert.id)).scalar() or 0,
    )


def _signal_payload(signal: EarlySignal, repo: Repo) -> dict[str, Any]:
    """欄位與 routers/early_signals.EarlySignalResponse 一致，前端直接套 formatSignalDescription。"""
    return {
        "id": signal.id,
        "repo_id": signal.repo_id,
        "repo_name": repo.full_name,
        "signal_type": signal.signal_type,
        "severity": signal.severity,
        "description": signal.description,
        "velocity_value": signal.velocity_value,
        "star_count": signal.star_count,
        "baseline_value": signal.baseline_value,
        "context_title": signal.context_title,
        "percentile_rank": signal.percentile_rank,
        "detected_at": signal.detected_at,
        "expires_at": signal.expires_at,
        "acknowledged": bool(signal.acknowledged),
        "acknowledged_at": signal.acknowledged_at,
    }


def _signal_is_highlight(signal: EarlySignal) -> bool:
    if signal.severity in DIGEST_HIGHLIGHT_SEVERITIES:
        return True
    # viral_hn 的嚴重度門檻比摘要的 HN 門檻高：100–199 分是 low。同一則討論沒被訊號化時
    # ≥ 50 分就是重點，去重改由訊號代表它之後不能因此降級。velocity_value 存的是 HN 分數
    return (
        signal.signal_type == EarlySignalType.VIRAL_HN
        and (signal.velocity_value or 0) >= DIGEST_HN_HIGHLIGHT_MIN_SCORE
    )


def build_digest(db: Session, cursor: DigestCursor | None) -> dict[str, Any]:
    """算出 id 大於 cursor 的所有事件，分成重點與其他更新。

    cursor 為 None（第一次使用）時只取最近 DIGEST_INITIAL_WINDOW_DAYS 天，但回傳的 cursor
    仍是三張表目前的最大 id——窗口外的舊列也要被蓋過，否則下次打開會把歷史全部倒出來。
    """
    # 先取上界，之後的查詢都夾在 (下界, 上界]：查詢途中剛寫入的列 id 會大於上界，
    # 這一批不含它、回傳的 cursor 也不會越過它，下一次一定看得到
    upper = _current_max_ids(db)
    lower = cursor or DigestCursor(0, 0, 0)
    since = None if cursor is not None else utc_now() - timedelta(days=DIGEST_INITIAL_WINDOW_DAYS)

    items: list[dict[str, Any]] = []

    signal_q = (
        db.query(EarlySignal, Repo)
        .join(Repo, Repo.id == EarlySignal.repo_id)
        .filter(
            EarlySignal.id > lower.early_signal_id,
            EarlySignal.id <= upper.early_signal_id,
            EarlySignal.acknowledged.is_(False),
        )
    )
    if since is not None:
        signal_q = signal_q.filter(EarlySignal.detected_at >= since)
    viral_titles: set[tuple[int, str]] = set()
    for signal, repo in signal_q.all():
        if signal.signal_type == EarlySignalType.VIRAL_HN and signal.context_title:
            viral_titles.add((signal.repo_id, signal.context_title))
        items.append({
            "key": f"signal:{signal.id}",
            "tier": "highlight" if _signal_is_highlight(signal) else "other",
            "kind": "signal",
            "repo": _repo_ref(repo),
            "occurred_at": _iso_utc(signal.detected_at),
            "url": None,
            "signal": _signal_payload(signal, repo),
        })

    context_q = (
        db.query(ContextSignal, Repo)
        .join(Repo, Repo.id == ContextSignal.repo_id)
        .filter(
            ContextSignal.id > lower.context_signal_id,
            ContextSignal.id <= upper.context_signal_id,
        )
    )
    if since is not None:
        context_q = context_q.filter(
            func.coalesce(ContextSignal.published_at, ContextSignal.fetched_at) >= since)
    for row, repo in context_q.all():
        occurred = row.published_at or row.fetched_at
        base = {"repo": _repo_ref(repo), "occurred_at": _iso_utc(occurred), "url": row.url,
                "title": row.title}
        if row.signal_type == ContextSignalType.RELEASE:
            tags = [t for t in (row.tags or "").split(",") if t]
            highlight = any(t in DIGEST_HIGHLIGHT_RELEASE_TAGS for t in tags)
            items.append({**base, "key": f"release:{row.id}", "kind": "release", "tags": tags,
                          "tier": "highlight" if highlight else "other"})
        elif row.signal_type == ContextSignalType.HACKER_NEWS:
            # viral_hn 訊號的 context_title 寫入時截到 255 字
            if (row.repo_id, row.title[:255]) in viral_titles:
                continue
            highlight = (row.score or 0) >= DIGEST_HN_HIGHLIGHT_MIN_SCORE
            items.append({**base, "key": f"hn:{row.id}", "kind": "hn", "score": row.score,
                          "tier": "highlight" if highlight else "other"})

    alert_q = (
        db.query(TriggeredAlert, AlertRule, Repo)
        .join(AlertRule, AlertRule.id == TriggeredAlert.rule_id)
        .join(Repo, Repo.id == TriggeredAlert.repo_id)
        .filter(
            TriggeredAlert.id > lower.triggered_alert_id,
            TriggeredAlert.id <= upper.triggered_alert_id,
            TriggeredAlert.acknowledged.is_(False),
        )
    )
    if since is not None:
        alert_q = alert_q.filter(TriggeredAlert.triggered_at >= since)
    for alert, rule, repo in alert_q.all():
        items.append({
            "key": f"alert:{alert.id}",
            "tier": "highlight",
            "kind": "alert",
            "repo": _repo_ref(repo),
            "occurred_at": _iso_utc(alert.triggered_at),
            "url": None,
            "rule_name": rule.name,
            "signal_type": rule.signal_type,
            "operator": rule.operator,
            "threshold": rule.threshold,
            "value": alert.signal_value,
        })

    def newest_first(group: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(group, key=lambda i: i["occurred_at"], reverse=True)

    highlights = newest_first([i for i in items if i["tier"] == "highlight"])
    others = newest_first([i for i in items if i["tier"] == "other"])
    return {
        "items": highlights + others[:DIGEST_OTHER_LIMIT],
        "other_total": len(others),
        "cursor": asdict(lower.merged(upper)),
        "releases_checked": get_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, db) is not None,
    }
