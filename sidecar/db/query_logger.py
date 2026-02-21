"""
資料庫查詢效能監控與慢查詢日誌。

提供 SQLAlchemy event listeners 用於：
- 記錄慢查詢
- 統計查詢時間
- 偵測 N+1 查詢問題
"""

import logging
import time
from typing import Any
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import Pool

logger = logging.getLogger(__name__)

# 慢查詢閾值（秒）
SLOW_QUERY_THRESHOLD = 0.5  # 500ms

# 查詢統計
_query_stats = {
    "total_queries": 0,
    "slow_queries": 0,
    "total_time": 0.0,
}


class QueryTimer:
    """查詢計時器，用於追蹤單一查詢的執行時間"""

    def __init__(self):
        self.start_time: float = 0.0
        self.query_count: int = 0

    def start(self):
        """開始計時"""
        self.start_time = time.perf_counter()
        self.query_count += 1

    def elapsed(self) -> float:
        """返回經過的時間（秒）"""
        return time.perf_counter() - self.start_time


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
        logger.info("Query logging disabled")
        return

    @event.listens_for(engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查詢執行前的事件處理器"""
        # 在連線上儲存開始時間
        conn.info.setdefault("query_start_time", []).append(time.perf_counter())

        # 記錄查詢（DEBUG 級別）
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(
                f"Executing SQL:\n{statement}\n"
                f"Parameters: {parameters}"
            )

    @event.listens_for(engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """查詢執行後的事件處理器"""
        # 計算執行時間
        start_time = conn.info["query_start_time"].pop(-1)
        elapsed = time.perf_counter() - start_time

        # 更新統計
        _query_stats["total_queries"] += 1
        _query_stats["total_time"] += elapsed

        # 記錄慢查詢
        if elapsed > SLOW_QUERY_THRESHOLD:
            _query_stats["slow_queries"] += 1

            # 截斷長查詢語句
            statement_preview = statement[:500]
            if len(statement) > 500:
                statement_preview += "..."

            logger.warning(
                f"⚠️  Slow query detected ({elapsed:.3f}s):\n"
                f"Statement: {statement_preview}\n"
                f"Parameters: {parameters}\n"
                f"Total queries: {_query_stats['total_queries']}, "
                f"Slow queries: {_query_stats['slow_queries']}"
            )

        # 記錄所有查詢時間（INFO 級別）
        elif logger.isEnabledFor(logging.INFO):
            logger.info(f"Query completed in {elapsed:.3f}s")

    @event.listens_for(Pool, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        """設定 SQLite 優化參數"""
        cursor = dbapi_conn.cursor()

        # 啟用 WAL 模式（更好的並發性能）
        cursor.execute("PRAGMA journal_mode=WAL")

        # 設定合理的快取大小（10MB）
        cursor.execute("PRAGMA cache_size=-10000")

        # 啟用外鍵約束
        cursor.execute("PRAGMA foreign_keys=ON")

        cursor.close()

    logger.info("Database query logging enabled (slow query threshold: %.1fs)", SLOW_QUERY_THRESHOLD)


def get_query_stats() -> dict[str, Any]:
    """
    取得查詢統計資訊。

    Returns:
        包含查詢統計的字典

    Example:
        >>> stats = get_query_stats()
        >>> print(f"Total queries: {stats['total_queries']}")
        >>> print(f"Slow queries: {stats['slow_queries']}")
        >>> print(f"Average time: {stats['avg_time']:.3f}s")
    """
    avg_time = (
        _query_stats["total_time"] / _query_stats["total_queries"]
        if _query_stats["total_queries"] > 0
        else 0.0
    )

    return {
        "total_queries": _query_stats["total_queries"],
        "slow_queries": _query_stats["slow_queries"],
        "total_time": _query_stats["total_time"],
        "avg_time": avg_time,
        "slow_query_ratio": (
            _query_stats["slow_queries"] / _query_stats["total_queries"]
            if _query_stats["total_queries"] > 0
            else 0.0
        ),
    }


def reset_query_stats():
    """重置查詢統計"""
    _query_stats["total_queries"] = 0
    _query_stats["slow_queries"] = 0
    _query_stats["total_time"] = 0.0


@contextmanager
def log_query_stats(label: str = "Operation"):
    """
    Context manager 用於記錄區塊內的查詢統計。

    Args:
        label: 操作標籤

    Example:
        >>> with log_query_stats("Fetch all repos"):
        ...     repos = db.query(Repo).all()
        >>> # 會自動記錄該操作的查詢統計
    """
    # 取得初始統計
    initial_stats = get_query_stats().copy()

    yield

    # 計算差異
    final_stats = get_query_stats()
    query_count = final_stats["total_queries"] - initial_stats["total_queries"]
    elapsed = final_stats["total_time"] - initial_stats["total_time"]

    logger.info(
        f"[{label}] Executed {query_count} queries in {elapsed:.3f}s "
        f"(avg: {elapsed/query_count:.3f}s)" if query_count > 0 else f"[{label}] No queries executed"
    )
