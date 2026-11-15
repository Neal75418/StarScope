"""setup_logging：正式環境把 log 寫進資料目錄的 starscope.log；root 已經有 handler 時不另開檔案。"""

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler

import pytest

from logging_config import setup_logging

QUIETED = ("httpx", "httpcore", "uvicorn.access", "apscheduler")


@pytest.fixture(autouse=True)
def restore_logger_levels():
    names = ("", *QUIETED)  # "" 是 root
    saved = {name: logging.getLogger(name).level for name in names}
    yield
    for name, level in saved.items():
        logging.getLogger(name).setLevel(level)


@contextmanager
def bare_root_logger() -> Iterator[logging.Logger]:
    """正式環境的行程裡，匯入 main 之前 root logger 沒有任何 handler。結束後放回 pytest 自己的 handler。

    要在測試本體裡用，不能做成 fixture：pytest 在每個階段（setup、call、teardown）各自另外掛上 handler，
    fixture 在 setup 清空之後，進到測試本體時 root 又有 handler。
    """
    root = logging.getLogger()
    saved = root.handlers[:]
    root.handlers = []
    try:
        yield root
    finally:
        for handler in root.handlers:
            handler.close()
        root.handlers = saved


def test_a_fresh_process_logs_to_the_file_in_the_data_dir(tmp_path):
    with bare_root_logger() as root:
        setup_logging(level="INFO", log_dir=str(tmp_path))

        files = [h for h in root.handlers if isinstance(h, RotatingFileHandler)]
        assert [h.baseFilename for h in files] == [str(tmp_path / "starscope.log")]
        # INFO：正式環境的 INFO 訊息要進得了檔案，root 的等級要真的設成 INFO
        logging.getLogger("starscope.test").info("寫得進去")
        for handler in files:
            handler.flush()
    assert "寫得進去" in (tmp_path / "starscope.log").read_text(encoding="utf-8")


def test_an_already_configured_root_is_left_alone_and_no_file_is_opened(tmp_path):
    """測試裡匯入 main 時就是這樣：pytest 已經在 root 掛了自己的 handler，basicConfig 不會做任何事。
    先開好的 log 檔沒有人掛上、也沒有人關，一離開 setup_logging 就被釋放、發出 ResourceWarning。
    少了這個判斷的話，DEBUG 沒開的環境（main.py 才會傳 log 目錄，例如沒有 .env 的 CI）每次都會紅在
    第一個匯入 main 的測試。"""
    root = logging.getLogger()
    before = root.handlers[:]
    assert before, "前提：pytest 在測試執行期間會在 root 掛自己的 handler"

    setup_logging(level="INFO", log_dir=str(tmp_path))

    assert root.handlers == before
    assert not (tmp_path / "starscope.log").exists()


def test_noisy_libraries_are_quieted_even_when_root_is_already_configured(tmp_path):
    for name in QUIETED:
        logging.getLogger(name).setLevel(logging.NOTSET)

    setup_logging(level="INFO", log_dir=str(tmp_path))

    assert {name: logging.getLogger(name).level for name in QUIETED} == dict.fromkeys(
        QUIETED, logging.WARNING
    )
