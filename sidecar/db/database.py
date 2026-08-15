"""SQLite 資料庫連線與 session 管理。"""

import logging
import os
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
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
    設定 SQLite 優化參數（所有連線共用）。
    WAL 模式提升併發讀寫效能，cache_size 提升查詢效能。
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA cache_size=-10000")  # 10MB 快取
    cursor.close()


# Session 工廠
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    FastAPI 路由的依賴注入。
    產出資料庫 session 並確保使用後關閉。
    例外時先 rollback 再關閉，避免依賴 SQLAlchemy 內部 close 行為。
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def get_db_session():
    """
    背景任務用的 context manager。
    FastAPI 路由請用 get_db() 依賴注入。
    例外時先 rollback 再關閉，與 get_db() 保持一致。
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# 既有資料表要補的欄位：{資料表: [(欄位名, SQLite 型別宣告)]}
#
# create_all() 只建新表，對已存在的表完全不動——所以在模型上加欄位，對開發者的
# 空資料庫是無感的，對使用者既有的資料庫卻會在第一次查詢時炸「no such column」。
#
# 這裡刻意不走 alembic：這個專案至今沒有版本表，接上去得先 stamp 一個版本，
# stamp 錯會讓之後所有 migration 對不上。相較之下，補一個可為空的欄位在 SQLite
# 是 O(1) 且不重寫資料的操作。等到需要改型別或搬資料時再正式引入 alembic。
_ADDITIVE_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "feed_items": [("opened_at", "DATETIME")],
    "repos": [("unstarred_at", "DATETIME"), ("starred_at", "DATETIME")],
}


def ensure_columns(target_engine: Engine | None = None) -> None:
    """補上既有資料表缺少的欄位。可重複執行。

    target_engine 只為了讓測試能對「舊 schema + 有資料」的資料庫執行真正的這段
    邏輯——正式呼叫不帶參數，用模組層級的 engine。
    """
    from sqlalchemy import text

    engine_ = target_engine if target_engine is not None else engine
    with engine_.begin() as conn:
        for table, columns in _ADDITIVE_COLUMNS.items():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            if not existing:
                continue  # 表還不存在，create_all 會用最新的模型直接建好
            for name, decl in columns:
                if name in existing:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {decl}"))
                logger.info(f"[資料庫] 已補上欄位 {table}.{name}")


def init_db():
    """
    建立所有資料表以初始化資料庫。
    應在應用程式啟動時呼叫一次。
    """
    from .models import Base
    Base.metadata.create_all(bind=engine)
    ensure_columns()
    # 必須在任何查詢發生之前註冊，否則封存的 repo 會從尚未套用過濾的查詢滲出來
    from .soft_delete import install_archive_filter
    install_archive_filter()
    logger.info(f"[資料庫] 初始化完成: {DATABASE_PATH}")

    # 啟用查詢效能監控（慢查詢日誌）
    # 在開發環境或設定 DEBUG=true 時啟用
    enable_query_logging = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
    if enable_query_logging or os.getenv("ENABLE_QUERY_LOGGING", "false").lower() in ("true", "1", "yes"):
        try:
            from .query_logger import setup_query_logging
            setup_query_logging(engine, enable=True)
        except ImportError:
            logger.warning("[查詢日誌] 模組不可用，跳過查詢日誌設定")
