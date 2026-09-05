"""SQLite 資料庫連線與 session 管理。"""

import logging
import os
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Column, Engine, MetaData, PrimaryKeyConstraint, Table, create_engine, event
from sqlalchemy.schema import ColumnCollectionConstraint
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


class SchemaNeedsMigration(RuntimeError):
    """schema 差異無法用「加一個欄位」補平，需要真正的 migration。"""


def _needs_migration_reason(table: Table, col: Column) -> str | None:
    """這個缺少的欄位能不能用 ADD COLUMN 補齊；不能就回傳原因。

    SQLite 的 ADD COLUMN 只接受「可為空、或有常數預設值」的欄位。UNIQUE 它本來就補不上
    （非唯一索引不在此列：ensure_columns 的索引階段會另外補）；FOREIGN KEY 其實 SQLite
    接受 `ADD COLUMN … REFERENCES`，但 SQLAlchemy 的 CreateColumn 不會產出 REFERENCES
    子句——所以這兩種若放行，都會靜默補成沒有約束的欄位，新資料庫（create_all）與既有
    使用者的資料庫就會行為不同，正是這套機制要消滅的那類失敗。
    """
    if not col.nullable and col.server_default is None:
        return "是 NOT NULL 且沒有 server_default，無法對既有資料表補上（既有列沒有值可填）"
    if col.foreign_keys:
        return "帶 FOREIGN KEY，CreateColumn 產出的 DDL 不含 REFERENCES，補上去會少掉外鍵"
    for cons in table.constraints:
        # Constraint 基底沒有 columns；PK / Unique / FK / Check 都是 ColumnCollectionConstraint
        if isinstance(cons, PrimaryKeyConstraint) or not isinstance(cons, ColumnCollectionConstraint):
            continue
        if col.name in {c.name for c in cons.columns}:
            return f"被 {type(cons).__name__} 涵蓋，ADD COLUMN 補不上表級約束"
    for idx in table.indexes:
        # 非唯一索引在 ensure_columns 的索引階段會用 CREATE INDEX IF NOT EXISTS 補上；
        # 唯一索引可能撞既有重複值，補不了
        if idx.unique and col.name in {c.name for c in idx.columns}:
            return "被唯一索引涵蓋，ADD COLUMN 補不上"
    return None


def ensure_columns(target_engine: Engine | None = None, metadata: MetaData | None = None) -> None:
    """把既有資料表補齊到目前 model 的欄位。可重複執行。

    來源是 model 本身，不是手工維護的清單：清單漏登記時，開發者的空資料庫由
    create_all() 建好、一切正常，只有既有使用者會在查詢時炸「no such column」，
    而那是本機重現不出來的。改成從 metadata 推導後，這個失敗模式不存在。

    create_all() 只建新表、對已存在的表完全不動，所以這一步不可省。

    能力邊界——做兩件事：對既有表 ADD COLUMN，以及把**非唯一索引**對齊 model
    （CREATE INDEX IF NOT EXISTS；新欄位、既有欄位都算；對既有資料不會失敗、冪等）。
    原則：能安全補的加法一律補，補了會炸資料的一律拒絕。
    下列差異**偵測得到**，會拋 SchemaNeedsMigration 讓啟動當場失敗而不是默默跳過：
      - 新欄位 NOT NULL 且沒有 server_default（既有列沒有值可填）
      - 新欄位帶 FOREIGN KEY、unique=True／唯一索引，或被任何表級約束涵蓋
    下列差異**偵測不到**，會靜默留著：改型別、改名、刪欄位、既有欄位上的唯一約束
    或唯一索引、文字型 CheckConstraint、需要回填的資料。這些只能靠人判斷——
    CLAUDE.md「schema 變更」一節列了該引入 alembic 的條件。

    NOT NULL + server_default 會補成 `DEFAULT <常數> NOT NULL`（SQLite 接受常數
    預設值；CURRENT_TIMESTAMP 這類非常數會被 SQLite 拒絕而大聲失敗）。

    不是原子的：pysqlite 不會為 DDL 開交易，每個 ADD COLUMN 各自生效。中途 raise
    時已補上的欄位會留著——它們各自都是合法的，下次啟動從缺的那個繼續。

    target_engine / metadata 只為了讓測試能對「舊 schema + 有資料」的資料庫、
    以及帶額外欄位的拋棄式 MetaData 執行真正的這段邏輯——正式呼叫不帶參數。
    """
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.schema import CreateColumn

    if metadata is None:
        from .models import Base
        metadata = Base.metadata
    engine_ = target_engine if target_engine is not None else engine

    missing: list[tuple[Table, Column]] = []
    with engine_.connect() as conn:
        for table in metadata.tables.values():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table.name})"))
            }
            if not existing:
                continue  # 表還不存在，create_all 會用最新的模型直接建好
            for col in table.columns:
                if col.name in existing:
                    continue
                reason = _needs_migration_reason(table, col)
                if reason is not None:
                    raise SchemaNeedsMigration(
                        f"{table.name}.{col.name} {reason}。這種變更需要真正的 migration。"
                    )
                missing.append((table, col))

    for table, col in missing:
        # CreateColumn 會連 NOT NULL / DEFAULT 一起產出。只用 type.compile() 的話這兩個
        # 會被丟掉，補出來的欄位跟 model 不一致，而 SQLite 對此完全不吭聲
        decl = str(CreateColumn(col).compile(dialect=engine_.dialect))
        try:
            with engine_.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {decl}"))
        except OperationalError as e:
            if "duplicate column name" in str(e).lower():
                # App 與 launchd 收集器同時首次遇到新 schema：另一個行程在 PRAGMA 之後、
                # ALTER 之前搶先補上了。欄位存在就是要的狀態，慢的一方不該因此啟動失敗
                logger.info(f"[資料庫] {table.name}.{col.name} 已由另一個行程補上，略過")
                continue
            raise
        logger.info(f"[資料庫] 已補上欄位 {table.name} ADD COLUMN {decl}")

    # ── 索引：非唯一索引對齊 model（新欄位、既有欄位都算）──
    # 資料庫側同時記名字與欄位組合，三種情況分開處理：
    #   - 同欄位組合已有非唯一、非 partial 的索引（不論名字）→ 已對齊，不動
    #   - 同名但欄位組合不同、或是 partial index → 非唯一索引可以安全重建（DROP + CREATE）。
    #     只靠 IF NOT EXISTS 會因為同名而無聲跳過，還記一條假的「已補上」（重審抓到的）
    #   - 同名但資料庫側是唯一索引 → 拒絕：拿掉唯一約束是 migration 的決定，不該在啟動時默默做
    # 比對不到 partial index 的 WHERE 條件與 expression index（PRAGMA index_info 對運算式回 None），
    # model 裡沒有這兩種；若出現，前者會被當成不對齊而重建、後者會被當成缺少而建立。
    from sqlalchemy.schema import CreateIndex

    def _quoted(name: str) -> str:
        return '"' + name.replace('"', '""') + '"'

    index_ddl: list[str] = []
    with engine_.connect() as conn:
        for table in metadata.tables.values():
            if conn.execute(text(f"PRAGMA table_info({table.name})")).first() is None:
                continue  # 表還不存在，create_all 會連索引一起建
            by_name: dict[str, tuple[tuple[str, ...], bool, bool]] = {}
            for row in conn.execute(text(f"PRAGMA index_list({table.name})")):
                name, unique, partial = row[1], bool(row[2]), bool(row[4])
                cols = tuple(r[2] for r in conn.execute(text(f"PRAGMA index_info({_quoted(name)})")))
                by_name[name] = (cols, unique, partial)
            aligned = {cols for cols, unique, partial in by_name.values() if not unique and not partial}
            for idx in table.indexes:
                if idx.unique:
                    continue  # 可能撞既有重複值，不在此處理（見 docstring）
                cols = tuple(c.name for c in idx.columns)
                twin = by_name.get(idx.name)
                if twin is not None:
                    twin_cols, twin_unique, twin_partial = twin
                    if twin_cols == cols and not twin_unique and not twin_partial:
                        continue
                    if twin_unique:
                        raise SchemaNeedsMigration(
                            f"{table.name} 的索引 {idx.name} 在資料庫裡是唯一索引，model 是非唯一。"
                            "拿掉唯一約束是 migration 的決定，不在啟動時默默做。"
                        )
                    index_ddl.append(f"DROP INDEX IF EXISTS {_quoted(idx.name)}")
                elif cols in aligned:
                    continue  # 同欄位已有別名的索引
                index_ddl.append(str(CreateIndex(idx, if_not_exists=True).compile(dialect=engine_.dialect)))

    for ddl in index_ddl:
        with engine_.begin() as conn:
            conn.execute(text(ddl))
        logger.info(f"[資料庫] 索引對齊 model: {ddl}")

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
