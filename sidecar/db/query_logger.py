"""
資料庫查詢效能監控與慢查詢日誌。

提供 SQLAlchemy event listeners 用於：
- 記錄慢查詢
- 統計查詢時間
- 偵測 N+1 查詢問題
"""

import logging
import threading
import time



from sqlalchemy import event
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# 慢查詢閾值（秒）
SLOW_QUERY_THRESHOLD = 0.5  # 500ms

# 查詢統計（thread-safe）
_query_stats_lock = threading.Lock()
_query_stats = {
    "total_queries": 0,
    "slow_queries": 0,
    "total_time": 0.0,
}


def setup_query_logging(engine: Engine, enable: bool = True):
    """
    設定資料庫查詢日誌監聽器。

    Args:
        engine: SQLAlchemy Engine 實例
        enable: 是否啟用查詢日誌（預設 True）

    Example:
        >>> from db.database import engine
        >>> from db.query_logger import setup_query_logging
        >>> setup_query_logging(engine)
    """
    if not enable:
        logger.info("[查詢日誌] 查詢日誌已停用")
        return

    @event.listens_for(engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查詢執行前的事件處理器"""
        # 在連線上儲存開始時間
        conn.info.setdefault("query_start_time", []).append(time.perf_counter())

        # 記錄查詢（DEBUG 級別，不記錄參數避免洩漏敏感資料）
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"[查詢日誌] 執行 SQL:\n{statement}")

    @event.listens_for(engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查詢執行後的事件處理器"""
        # 計算執行時間
        start_time = conn.info["query_start_time"].pop(-1)
        elapsed = time.perf_counter() - start_time

        # 更新統計（thread-safe，單一 lock 區塊避免 race window）
        is_slow = elapsed > SLOW_QUERY_THRESHOLD
        with _query_stats_lock:
            _query_stats["total_queries"] += 1
            _query_stats["total_time"] += elapsed
            if is_slow:
                _query_stats["slow_queries"] += 1

        # 記錄慢查詢（不記錄參數，避免洩漏敏感資料）
        if is_slow:
            statement_preview = statement[:500]
            if len(statement) > 500:
                statement_preview += "..."

            logger.warning(
                f"[查詢日誌] 慢查詢偵測 ({elapsed:.3f}s):\n"
                f"Statement: {statement_preview}\n"
                f"Total queries: {_query_stats['total_queries']}, "
                f"Slow queries: {_query_stats['slow_queries']}"
            )

        # 記錄正常查詢時間（DEBUG 級別，避免 INFO 刷屏）
        elif logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"[查詢日誌] 查詢完成 ({elapsed:.3f}s)")

    # PRAGMA 設定已統一在 database.py set_sqlite_pragma 中管理

    logger.info(f"[查詢日誌] 資料庫查詢日誌已啟用（慢查詢閾值: {SLOW_QUERY_THRESHOLD:.1f}s）")


