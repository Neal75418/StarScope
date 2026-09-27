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


limiter = Limiter(key_func=_get_client_host, default_limits=["120/minute"])
