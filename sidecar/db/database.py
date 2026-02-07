"""SQLite 資料庫連線與 session 管理。"""

import logging
import os
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)


def get_app_data_dir() -> Path:
    """
    取得 OS 標準的應用程式資料目錄，可透過環境變數覆蓋。

    優先順序:
    1. STARSCOPE_DATA_DIR — 明確覆蓋（測試或自訂路徑）
    2. TAURI_APP_DATA_DIR — Tauri 正式環境注入
    3. 回退至 ~/.starscope（開發環境）
    """
    if env_path := os.environ.get("STARSCOPE_DATA_DIR"):
        return Path(env_path)

    if tauri_path := os.environ.get("TAURI_APP_DATA_DIR"):
        return Path(tauri_path)

    # 開發環境回退
    return Path.home() / ".starscope"


# 資料庫檔案位置
APP_DATA_DIR = get_app_data_dir()
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = APP_DATA_DIR / "starscope.db"

# SQLite 連線 URL
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# 建立 engine（含 SQLite 專用設定）
engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,  # SQLite 搭配 FastAPI 必須設定
        "timeout": 30,  # 鎖等待最多 30 秒（預設 5 秒）
    },
    pool_pre_ping=True,  # 使用前驗證連線
    echo=False,  # 設為 True 可除錯 SQL
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, _connection_record):
    """
    啟用 WAL 模式以提升併發讀寫效能。
    WAL 允許讀取與寫入同時進行而不互相阻塞。
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# Session 工廠
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    FastAPI 路由的依賴注入。
    產出資料庫 session 並確保使用後關閉。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_session():
    """
    背景任務用的 context manager。
    FastAPI 路由請用 get_db() 依賴注入。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    建立所有資料表以初始化資料庫。
    應在應用程式啟動時呼叫一次。
    """
    from .models import Base
    Base.metadata.create_all(bind=engine)
    logger.info(f"[資料庫] 初始化完成: {DATABASE_PATH}")
