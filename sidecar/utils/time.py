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


def local_today() -> date:
    """
    取得當前「本機時區」日期，用於 feed_date 等使用者感知的日曆日鍵。

    刻意與 utc_today() 不同：cron 排程（APScheduler 預設用本機時區觸發）
    與使用者打開 App 的當下都是本機時間，若日期鍵改用 UTC 日期，
    在 UTC+8 等時區會於本地清晨到 UTC 換日前（本地 08:00 前）
    整段時間錯配成「前一天」，導致排程寫入的批次與使用者查詢的日期對不上。
    """
    return datetime.now().date()
