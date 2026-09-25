"""「自上次以來」摘要：追蹤清單裡的 repo 自上次看過之後發生了什麼。

「新」以資料列 id 判定，不用時間：release 與 HN 是 upsert，重抓會刷新 fetched_at；
published_at 又可能早於 StarScope 得知的時間（離線三天後才抓到四天前的 release）。
id 只有真的新增時才會變大。設計見 docs/superpowers/specs/2026-09-25-since-last-visit-digest-design.md
"""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from db.models import AppSettingKey
from services.settings import delete_setting, get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)


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
