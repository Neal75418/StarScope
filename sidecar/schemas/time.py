"""API 輸出的日期時間一律帶 UTC 時區。

DB 與 utc_now() 慣例是 naive UTC；pydantic 與 isoformat() 序列化 naive datetime 時不帶時區，
前端 new Date() 會把 "2026-09-25T12:00:00" 當成本地時間（台灣差 8 小時）。
response model 的 datetime 欄位一律宣告成 UtcDateTime，手寫的輸出用 to_utc_iso()；
tests/test_api_timestamps_utc.py 兩者都會檢查。只有日期的欄位（date）不在此列。
"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer, WithJsonSchema


def to_utc_iso(value: datetime) -> str:
    """naive 視為 UTC；aware 轉成 UTC。輸出帶 +00:00。"""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


# WithJsonSchema：PlainSerializer 回傳 str，OpenAPI 會退化成單純的 string，這裡把 date-time 標回去
UtcDateTime = Annotated[
    datetime,
    PlainSerializer(to_utc_iso, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]
