"""個別端點的限流（@limiter.limit）真的會擋。

limiter 沒有全域預設值，保護全靠這些 decorator；少了一個不會有任何錯誤，
只會讓連按更新把 GitHub 搜尋配額吃光，症狀出現在別的頁面。
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from middleware.rate_limit import limiter


@pytest.fixture
def fresh_limiter():
    # limiter 的計數是模組層級的記憶體狀態，前後都清掉，不跟別的測試互相影響
    limiter.reset()
    yield
    limiter.reset()


def test_trending_refresh_is_limited_to_two_per_minute(client, fresh_limiter):
    with patch("routers.interests.get_github_service", return_value=MagicMock()), \
         patch("routers.interests.compute_trending_topics", new=AsyncMock(return_value=[])):
        codes = [client.post("/api/interests/trending/refresh").status_code for _ in range(3)]

    assert codes == [200, 200, 429]
