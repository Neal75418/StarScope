"""StarScope sidecar 的 logging 設定。"""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler


def setup_logging(
    level: str = "INFO",
    log_format: str | None = None,
    log_dir: str | None = None,
) -> None:
    """
    設定應用程式 logging。root logger 已經有 handler 時不動它（level、格式與 log 檔都不設），
    只調第三方 logger 的等級。

    Args:
        level: 日誌層級（DEBUG, INFO, WARNING, ERROR, CRITICAL）
        log_format: 自訂日誌格式字串
        log_dir: 日誌檔案目錄，設定後啟用 RotatingFileHandler（root 還沒有 handler 時）
    """
    if log_format is None:
        log_format = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"

    # root 已經有 handler 時 basicConfig 不會做任何事（測試裡匯入 main 時就是這樣：pytest 先掛了自己的）。
    # 這時不能先建 RotatingFileHandler：它一建好就開了檔案，沒有人掛上也沒有人關
    if not logging.getLogger().handlers:
        handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]

        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, "starscope.log")
            file_handler = RotatingFileHandler(
                log_path,
                maxBytes=5 * 1024 * 1024,  # 5 MB
                backupCount=3,
                encoding="utf-8",
            )
            file_handler.setFormatter(
                logging.Formatter(log_format, datefmt="%Y-%m-%d %H:%M:%S")
            )
            handlers.append(file_handler)

        logging.basicConfig(
            level=getattr(logging, level.upper()),
            format=log_format,
            datefmt="%Y-%m-%d %H:%M:%S",
            handlers=handlers,
        )

    # 將第三方 logger 設為 WARNING 以減少雜訊
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    logger = logging.getLogger("starscope")
    logger.info(f"[日誌] 日誌層級已設定為 {level}")
