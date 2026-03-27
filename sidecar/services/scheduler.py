"""
背景排程服務，用於定期資料抓取。
使用 APScheduler 按設定間隔執行工作。
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import threading
import time as _time
import uuid
from contextlib import contextmanager
from datetime import timedelta

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import create_engine, event, func, select as sa_select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Query, Session

from constants import (
    CONTEXT_FETCH_INTERVAL_MINUTES,
    DEFAULT_SNAPSHOT_RETENTION_DAYS,
    SCHEDULER_BATCH_SIZE,
    SCHEDULER_SHUTDOWN_TIMEOUT_SECONDS,
)
from db.database import DATABASE_URL, get_db_session
from db.models import Repo, RepoSnapshot
from services.context_fetcher import fetch_all_context_signals
from services.github import fetch_repo_data, GitHubAPIError
from services.snapshot import update_repo_from_github
from services.backup import backup_database
from utils.time import utc_now

logger = logging.getLogger(__name__)


@contextmanager
def _job_context(job_name: str):
    """
    為排程工作建立 correlation ID 並注入 logger。
    所有 log 訊息自動帶上 job_id 以便追蹤。
    """
    job_id = uuid.uuid4().hex[:8]
    job_logger = logging.LoggerAdapter(logger, {"job_id": job_id})
    job_logger.info(f"[排程] [{job_id}] {job_name} 開始")
    try:
        yield job_logger
    except Exception:
        job_logger.error(f"[排程] [{job_id}] {job_name} 異常結束", exc_info=True)
        raise
    else:
        job_logger.info(f"[排程] [{job_id}] {job_name} 完成")


# 全域排程器實例
_scheduler: AsyncIOScheduler | None = None
_scheduler_lock = threading.Lock()

# Repo 連續失敗計數器（記憶體內，重啟後歸零）
_repo_failure_counts: dict[int, int] = {}
_failure_counts_lock = threading.Lock()

# 排程健康狀態追蹤（記憶體內）
_scheduler_health: dict[str, float | str | None] = {
    "last_fetch_success": None,
    "last_fetch_failure": None,
    "last_fetch_error": None,
    "last_alert_check": None,
    "last_backup": None,
}
_health_lock = threading.Lock()


def _update_health(**kwargs: float | str | None) -> None:
    """線程安全地更新排程健康狀態。"""
    with _health_lock:
        _scheduler_health.update(kwargs)


def get_scheduler_health() -> dict[str, float | str | None]:
    """取得排程器健康狀態。"""
    with _health_lock:
        return dict(_scheduler_health)


FAILURE_ALERT_THRESHOLD = 5  # 連續失敗 N 次後記錄 WARNING


def get_scheduler() -> AsyncIOScheduler:
    """取得全域排程器實例（使用 SQLAlchemy jobstore 持久化）。"""
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                jobstore_engine = create_engine(
                    DATABASE_URL,
                    connect_args={"check_same_thread": False, "timeout": 30},
                )
                # 與主 engine 相同的 SQLite pragma，避免 journal mode 不一致導致鎖衝突
                @event.listens_for(jobstore_engine, "connect")
                def _set_jobstore_pragma(dbapi_conn, _conn_record):
                    cursor = dbapi_conn.cursor()
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA foreign_keys=ON")
                    cursor.close()
                jobstores = {
                    "default": SQLAlchemyJobStore(engine=jobstore_engine),
                }
                _scheduler = AsyncIOScheduler(jobstores=jobstores)
    return _scheduler


def _track_repo_failure(repo_id: int, full_name: str, reason: str) -> None:
    """追蹤 repo 連續失敗次數，超過閾值時記錄 WARNING。"""
    with _failure_counts_lock:
        count = _repo_failure_counts.get(repo_id, 0) + 1
        _repo_failure_counts[repo_id] = count

    if count == FAILURE_ALERT_THRESHOLD:
        logger.warning(
            f"[排程] {full_name} 已連續失敗 {count} 次，"
            f"最近原因: {reason[:200]}"
        )
    elif count > FAILURE_ALERT_THRESHOLD and count % FAILURE_ALERT_THRESHOLD == 0:
        logger.warning(
            f"[排程] {full_name} 持續失敗中（共 {count} 次），"
            f"最近原因: {reason[:200]}"
        )


def _build_need_fetch_query(
    db: Session,
    skip_recent_minutes: int,
    log: logging.LoggerAdapter,
    job_id: str,
) -> tuple[Query[Repo], int, int] | None:
    """建立需要抓取的 repo 查詢，跳過近期已抓取的項目。

    Returns:
        ``(need_fetch_query, total_count, skipped_count)`` tuple，或
        ``None``（當監控清單為空時）。

        - ``need_fetch_query``: 需要抓取的 repo 查詢
        - ``total_count``: 監控清單中的 repo 總數
        - ``skipped_count``: 因近期已抓取而跳過的 repo 數量
    """
    recent_threshold = utc_now() - timedelta(minutes=skip_recent_minutes)

    # 子查詢：近期已抓取的 repo ID（將被跳過）
    recently_fetched_ids = (
        db.query(RepoSnapshot.repo_id)
        .group_by(RepoSnapshot.repo_id)
        .having(func.max(RepoSnapshot.fetched_at) > recent_threshold)
        .subquery()
    )

    # 建構需抓取的 repo 查詢（跳過近期已抓取的）
    need_fetch_query = (
        db.query(Repo)
        .filter(Repo.id.notin_(db.query(recently_fetched_ids.c.repo_id)))
    )

    total_count = db.query(func.count(Repo.id)).scalar() or 0

    if total_count == 0:
        log.info(f"[排程] [{job_id}] 監控清單無 repo，跳過抓取")
        return None

    # skipped_count 在 job 完成後從結果反推，避免額外的 COUNT 查詢
    return need_fetch_query, total_count, 0


async def _fetch_and_update_single_repo(
    repo: Repo,
    db: Session,
    log: logging.LoggerAdapter,
    job_id: str,
) -> bool:
    """從 GitHub 抓取單一 repo 資料並更新資料庫。

    Returns:
        ``True`` 表示成功，``False`` 表示失敗。
    """
    repo_id = int(repo.id)
    try:
        # 從 GitHub 取得最新資料
        github_data = await fetch_repo_data(repo.owner, repo.name)

        if github_data:
            # 原子性地更新中繼資料 + 快照 + 訊號
            update_repo_from_github(repo, github_data, db)

            # 成功時重置失敗計數
            with _failure_counts_lock:
                _repo_failure_counts.pop(repo_id, None)
            log.debug(f"[排程] [{job_id}] 已抓取 {repo.full_name}")
            return True
        else:
            _track_repo_failure(repo_id, repo.full_name, "資料為空")
            return False

    except (GitHubAPIError, SQLAlchemyError) as e:
        db.rollback()
        _track_repo_failure(repo_id, repo.full_name, str(e))
        log.error(f"[排程] [{job_id}] 抓取 {repo.full_name} 失敗: {e}", exc_info=True)
        return False
    except Exception as e:
        # 未預期的錯誤：記錄為 critical 但繼續處理其他 repos
        db.rollback()
        _track_repo_failure(repo_id, repo.full_name, str(e))
        log.critical(f"[排程] [{job_id}] 抓取 {repo.full_name} 未預期錯誤: {e}", exc_info=True)
        return False


def _cleanup_snapshots_job() -> None:
    """快照清理工作，從 DB 讀取保留天數設定。"""
    with _job_context("快照清理") as log:
        with get_db_session() as db:
            try:
                from db.models import AppSettingKey
                from services.settings import get_setting
                value = get_setting(AppSettingKey.SNAPSHOT_RETENTION_DAYS, db)
                retention_days = int(value) if value else DEFAULT_SNAPSHOT_RETENTION_DAYS
            except Exception as e:
                log.warning(f"[排程] 讀取快照保留天數失敗（使用預設值 {DEFAULT_SNAPSHOT_RETENTION_DAYS} 天）: {e}")
                retention_days = DEFAULT_SNAPSHOT_RETENTION_DAYS
        cleanup_old_snapshots(retention_days)


async def fetch_all_repos_job(skip_recent_minutes: int = 30) -> None:
    """
    背景工作：抓取追蹤清單中所有 repo。
    根據設定的間隔定期執行。

    Args:
        skip_recent_minutes: 跳過此分鐘數內已抓取的 repo（預設 30）。
                           避免重啟後重複抓取。
    """
    job_id = uuid.uuid4().hex[:8]
    log = logging.LoggerAdapter(logger, {"job_id": job_id})
    log.info(f"[排程] [{job_id}] 開始排程抓取所有 repo...")

    with get_db_session() as db:
        try:
            # 在每次批次抓取前從 DB 重新載入 Early Signal 偵測門檻
            try:
                from services.anomaly_detector import reload_thresholds_from_db
                reload_thresholds_from_db(db)
            except Exception as e:
                log.warning(f"[排程] [{job_id}] 重新載入偵測門檻失敗（使用預設值）: {e}")

            result = _build_need_fetch_query(db, skip_recent_minutes, log, job_id)
            if result is None:
                return
            need_fetch_query, total_count, _ = result

            success_count = 0
            error_count = 0

            # 先載入完整清單再迭代，避免 yield_per streaming cursor 在
            # 單一 repo rollback 後失效導致後續 repo 全被跳過
            repos_to_fetch = need_fetch_query.all()
            for repo in repos_to_fetch:
                if await _fetch_and_update_single_repo(repo, db, log, job_id):
                    success_count += 1
                else:
                    error_count += 1

            # skipped_count 從結果反推，避免額外 COUNT 查詢
            skipped_count = total_count - success_count - error_count

            log.info(
                f"[排程] [{job_id}] 排程抓取完成: {success_count} 成功、"
                f"{error_count} 失敗、{skipped_count} 跳過 (近期已抓取)"
            )
            if error_count == 0:
                _update_health(last_fetch_success=_time.time(), last_fetch_error=None)
            else:
                _update_health(last_fetch_failure=_time.time(), last_fetch_error=f"{error_count} repos 抓取失敗")

        except (GitHubAPIError, SQLAlchemyError) as e:
            log.error(f"[排程] [{job_id}] 資料庫/API 錯誤: {e}", exc_info=True)
            _update_health(last_fetch_failure=_time.time(), last_fetch_error=str(e)[:200])
            # 可恢復的錯誤，不中斷排程
        except KeyboardInterrupt:
            log.info(f"[排程] [{job_id}] 收到中斷信號")
            raise
        except Exception as e:
            log.critical(f"[排程] [{job_id}] 未預期的嚴重錯誤: {e}", exc_info=True)
            # 嚴重錯誤，記錄並重新拋出
            raise


def check_alerts_job() -> None:
    """
    背景工作：檢查警報規則並觸發通知。
    在資料抓取後執行。
    """
    with _job_context("檢查警報規則") as log:
        # 在此 import 以避免循環引用
        try:
            from services.alerts import check_all_alerts
        except ImportError:
            log.debug("[排程] 警報服務尚未可用")
            return

        with get_db_session() as db:
            try:
                triggered = check_all_alerts(db)

                _update_health(last_alert_check=_time.time())
                if triggered:
                    log.info(f"[排程] 已觸發 {len(triggered)} 個警報")
                else:
                    log.debug("[排程] 無警報觸發")

            except SQLAlchemyError as e:
                log.error(f"[排程] 檢查警報資料庫錯誤: {e}", exc_info=True)
            except Exception as e:
                log.critical(f"[排程] 檢查警報未預期錯誤: {e}", exc_info=True)


async def fetch_context_signals_job() -> None:
    """
    背景工作：為所有 repo 抓取情境訊號。
    從 Hacker News 抓取並執行清理。
    """
    job_id = uuid.uuid4().hex[:8]
    log = logging.LoggerAdapter(logger, {"job_id": job_id})
    log.info(f"[排程] [{job_id}] 開始排程抓取上下文訊號...")

    with get_db_session() as db:
        try:
            result = await fetch_all_context_signals(db)
            log.info(
                f"[排程] [{job_id}] 上下文訊號抓取完成: "
                f"HN={result['new_hn_signals']}、"
                f"錯誤={result['errors']}"
            )

            # 執行清理以防止無限成長
            from services.context_fetcher import cleanup_old_context_signals
            cleanup_stats = cleanup_old_context_signals(db)
            if cleanup_stats["deleted_by_age"] > 0 or cleanup_stats["deleted_by_limit"] > 0:
                log.info(f"[排程] [{job_id}] 上下文訊號清理: {cleanup_stats}")
        except SQLAlchemyError as e:
            log.error(f"[排程] [{job_id}] 上下文訊號資料庫錯誤: {e}", exc_info=True)
        except Exception as e:
            log.critical(f"[排程] [{job_id}] 上下文訊號未預期錯誤: {e}", exc_info=True)


def cleanup_old_snapshots(retention_days: int = 90) -> int:
    """
    清理超過保留天數的舊快照，防止資料庫無限增長。
    每個 repo 至少保留一筆最新快照。

    Args:
        retention_days: 快照保留天數（預設 90 天）

    Returns:
        已刪除的快照數量
    """
    with get_db_session() as db:
        try:
            cutoff = (utc_now() - timedelta(days=retention_days)).date()

            # 子查詢：每個 repo 的最新快照 ID（絕不刪除）
            latest_ids = (
                sa_select(func.max(RepoSnapshot.id))
                .group_by(RepoSnapshot.repo_id)
            )

            # 刪除過期快照，但保留每個 repo 的最新一筆
            deleted = (
                db.query(RepoSnapshot)
                .filter(
                    RepoSnapshot.snapshot_date < cutoff,
                    ~RepoSnapshot.id.in_(latest_ids)
                )
                .delete(synchronize_session=False)
            )

            db.commit()

            if deleted > 0:
                logger.info(f"[排程] 快照清理: 刪除 {deleted} 筆超過 {retention_days} 天的快照")

            return int(deleted)
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"[排程] 快照清理失敗: {e}", exc_info=True)
            return 0


def backup_job() -> None:
    """資料庫備份工作（模組層級，供 APScheduler 序列化引用）。"""
    try:
        # 取得資料庫檔案路徑
        from sqlalchemy.engine import make_url
        db_file = make_url(DATABASE_URL).database or ""

        # 如果是記憶體資料庫或測試環境則跳過
        if db_file == ":memory:" or os.getenv("ENV") == "test":
            logger.debug("[排程] 跳過備份（記憶體資料庫或測試環境）")
            return

        logger.info(f"[排程] 開始資料庫備份: {db_file}")
        backup_path = backup_database(db_file, retention_days=7)

        if backup_path:
            logger.info(f"[排程] 資料庫備份成功: {backup_path}")
            _update_health(last_backup=_time.time())
        else:
            logger.error("[排程] 資料庫備份失敗")

    except (OSError, IOError) as e:
        logger.error(f"[排程] 資料庫備份檔案操作錯誤: {e}", exc_info=True)
    except Exception as e:
        logger.critical(f"[排程] 資料庫備份未預期錯誤: {e}", exc_info=True)


def _register_fetch_job(scheduler, interval_minutes: int) -> None:
    """註冊資料抓取工作。"""
    scheduler.add_job(
        fetch_all_repos_job,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="fetch_all_repos",
        name="Fetch all repos from GitHub",
        replace_existing=True,
        max_instances=1,  # 防止重複執行
    )


def _register_alert_job(scheduler, interval_minutes: int) -> None:
    """註冊警報檢查工作（抓取後 1 分鐘執行）。"""
    scheduler.add_job(
        check_alerts_job,
        trigger=IntervalTrigger(
            minutes=interval_minutes,
            start_date=utc_now() + timedelta(minutes=1),
        ),
        id="check_alerts",
        name="Check alert rules",
        replace_existing=True,
        max_instances=1,
    )


def _register_context_job(scheduler) -> None:
    """註冊情境訊號工作（每 30 分鐘執行）。"""
    scheduler.add_job(
        fetch_context_signals_job,
        trigger=IntervalTrigger(minutes=CONTEXT_FETCH_INTERVAL_MINUTES),
        id="fetch_context_signals",
        name="Fetch context signals (HN)",
        replace_existing=True,
        max_instances=1,
    )


def _register_cleanup_jobs(scheduler) -> None:
    """註冊清理工作（快照清理 + 資料庫備份）。"""
    from apscheduler.triggers.cron import CronTrigger

    # 每日清理過期快照（保留天數從 DB 設定讀取，預設 90 天）
    scheduler.add_job(
        _cleanup_snapshots_job,
        trigger=IntervalTrigger(hours=24),
        id="cleanup_old_snapshots",
        name="Cleanup old snapshots (retention from DB)",
        replace_existing=True,
        max_instances=1,
    )

    # 每日資料庫備份（凌晨 2 點，保留 7 天）
    scheduler.add_job(
        backup_job,
        trigger=CronTrigger(hour=2, minute=0),  # 每天凌晨 2 點
        id="database_backup",
        name="Daily database backup (7d retention)",
        replace_existing=True,
        max_instances=1,
    )


def start_scheduler(fetch_interval_minutes: int = 60) -> None:
    """
    啟動背景排程器。
    若 DB 中有儲存的排程間隔設定，優先使用 DB 值。

    Args:
        fetch_interval_minutes: 資料抓取頻率預設值（DB 設定優先）
    """
    # 從 DB 讀取排程間隔（若已設定則覆蓋參數）
    try:
        from db.models import AppSettingKey
        from services.settings import get_setting
        with get_db_session() as db:
            stored = get_setting(AppSettingKey.FETCH_INTERVAL_MINUTES, db)
            if stored:
                fetch_interval_minutes = int(stored)
    except Exception as e:
        logger.warning(f"[排程] 讀取排程間隔失敗，使用預設值 {fetch_interval_minutes} 分鐘: {e}")

    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("[排程] 排程器已在執行中")
        return

    _register_fetch_job(scheduler, fetch_interval_minutes)
    _register_alert_job(scheduler, fetch_interval_minutes)
    _register_context_job(scheduler)
    _register_cleanup_jobs(scheduler)

    scheduler.start()
    logger.info(
        f"[排程] 排程器已啟動: 資料抓取每 {fetch_interval_minutes} 分鐘、"
        f"上下文訊號每 {CONTEXT_FETCH_INTERVAL_MINUTES} 分鐘、"
        f"快照清理每 24 小時、資料庫備份每日 02:00"
    )


async def stop_scheduler() -> None:
    """停止背景排程器（最多等待指定秒數讓進行中的任務完成）。"""
    scheduler = get_scheduler()

    if scheduler.running:
        try:
            await asyncio.wait_for(
                asyncio.to_thread(scheduler.shutdown, wait=True),
                timeout=SCHEDULER_SHUTDOWN_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning("[排程] 排程器停止超時，強制關閉")
            scheduler.shutdown(wait=False)
        logger.info("[排程] 排程器已停止")


async def trigger_fetch_now() -> None:
    """手動觸發立即抓取所有 repo 與情境訊號。"""
    logger.info("[排程] 手動抓取已觸發")
    await fetch_all_repos_job()
    # 在執行緒中執行同步警報檢查以避免阻塞 event loop
    await asyncio.to_thread(check_alerts_job)
    # 同時抓取 HN 情境訊號
    await fetch_context_signals_job()
