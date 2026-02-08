"""
Rate limiter 設定，使用 slowapi。
提供全域 limiter 實例與逐端點限流裝飾器。
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
