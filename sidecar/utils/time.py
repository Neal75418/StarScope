"""
時間工具函式，確保日期時間處理一致。
所有時間戳皆為 UTC naive datetime（無 tzinfo），與 SQLite 儲存格式一致。
"""

from datetime import datetime, timezone, date


def utc_now() -> datetime:
    """
    取得當前 UTC 時間，回傳 naive datetime（無 tzinfo）。
    SQLite 儲存不帶時區資訊的 datetime，因此所有時間戳
    必須為 naive 以確保比較一致。
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_today() -> date:
    """取得當前 UTC 日期。"""
    return utc_now().date()
