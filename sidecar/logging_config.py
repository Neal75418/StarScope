"""StarScope sidecar 的 logging 設定。"""

import logging
import sys
from typing import Optional


def setup_logging(
    level: str = "INFO",
    log_format: Optional[str] = None,
) -> None:
    """
    設定應用程式 logging。

    Args:
        level: 日誌層級（DEBUG, INFO, WARNING, ERROR, CRITICAL）
        log_format: 自訂日誌格式字串
    """
    if log_format is None:
        log_format = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"

    # 設定 root logger
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format=log_format,
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    # 將第三方 logger 設為 WARNING 以減少雜訊
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    # 取得應用程式 logger
    logger = logging.getLogger("starscope")
    logger.info(f"[日誌] 日誌層級已設定為 {level}")
