"""utils/time.py 的日期鍵語意測試：local_today 必須用本機時區，不是 UTC。"""
from datetime import date, datetime
from unittest.mock import patch

from utils.time import local_today


def test_local_today_uses_naive_local_datetime_not_utc():
    """local_today() 必須直接用 datetime.now()（本機時區），
    不能像 utc_today() 一樣經過 datetime.now(timezone.utc)。

    用一個固定的本機時刻模擬「UTC 已跨日、本機時區還沒跨日」的情境：
    本機 2026-08-01 23:30，此時 UTC（例如 UTC+8）已是 2026-08-02。
    這正是 finding 1 描述的 cron 07:30 本地 = UTC 前一天 23:30 的鏡像情境。
    """
    fixed_local = datetime(2026, 8, 1, 23, 30, 0)
    with patch("utils.time.datetime") as mock_dt:
        mock_dt.now.return_value = fixed_local
        result = local_today()
    mock_dt.now.assert_called_once_with()
    assert result == date(2026, 8, 1)
