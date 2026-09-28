"""
Rate limiter 設定，使用 slowapi。
提供全域 limiter 實例與逐端點限流裝飾器。
"""

from starlette.requests import Request
from slowapi import Limiter


def _get_client_host(request: Request) -> str:
    """取得直接連線的客戶端 IP，不信任 proxy header（桌面 sidecar 不需要）。"""
    client = request.client  # 存成區域變數：property 的 None 收窄不會延續到下一行
    if client:
        return client.host
    return "127.0.0.1"


# 沒有 default_limits：只對會打 GitHub 或運算量大的端點用 @limiter.limit 個別限流。
# - default_limits 只在掛上 SlowAPIMiddleware 時才生效；那個 middleware 靠攤平的 app.routes 找端點，
#   FastAPI 0.137 起子 router 不再攤平，掛了也找不到任何端點（實測連打 130 次全是 200）
# - 全域上限對本機 sidecar 也不合適：key 是用戶端 IP，app 所有頁面與輪詢都擠在 127.0.0.1 同一個桶子裡
limiter = Limiter(key_func=_get_client_host)
