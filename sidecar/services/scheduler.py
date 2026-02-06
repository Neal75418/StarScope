"""
背景排程服務，用於定期資料抓取。
使用 APScheduler 按設定間隔執行工作。
"""

import asyncio
import logging
import threading
from datetime import timedelta
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import Repo, RepoSnapshot
from services.github import fetch_repo_data
from services.snapshot import update_repo_from_github
from services.context_fetcher import fetch_all_context_signals
from utils.time import utc_now
from constants import CONTEXT_FETCH_INTERVAL_MINUTES

logger = logging.getLogger(__name__)

# 全域排程器實例
_scheduler: Optional[AsyncIOScheduler] = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> AsyncIOScheduler:
    """取得全域排程器實例。"""
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                _scheduler = AsyncIOScheduler()
    return _scheduler


async def fetch_all_repos_job(skip_recent_minutes: int = 30):
    """
    背景工作：抓取追蹤清單中所有 repo。
    根據設定的間隔定期執行。

    Args:
        skip_recent_minutes: 跳過此分鐘數內已抓取的 repo（預設 30）。
                           避免重啟後重複抓取。
    """
    logger.info("[排程] 開始排程抓取所有 repo...")

    db: Session = SessionLocal()
    try:
        from sqlalchemy import func

        # 使用 naive datetime 與 DB 值比較（SQLite 儲存 naive datetime）
        recent_threshold = (utc_now() - timedelta(minutes=skip_recent_minutes)).replace(tzinfo=None)

        # 子查詢：近期已抓取的 repo ID（將被跳過）
        recently_fetched_ids = (
            db.query(RepoSnapshot.repo_id)
            .group_by(RepoSnapshot.repo_id)
            .having(func.max(RepoSnapshot.fetched_at) > recent_threshold)
            .subquery()
        )

        # 僅載入需要抓取的 repo（在 DB 層篩選）
        repos = (
            db.query(Repo)
            .filter(Repo.id.notin_(db.query(recently_fetched_ids.c.repo_id)))
            .all()
        )

        total_count = db.query(func.count(Repo.id)).scalar() or 0
        skipped_count = total_count - len(repos)

        if total_count == 0:
            logger.info("[排程] 監控清單無 repo，跳過抓取")
            return

        success_count = 0
        error_count = 0

        if skipped_count > 0:
            logger.debug(f"[排程] 跳過 {skipped_count} 個近期已抓取的 repo")

        for repo in repos:

            try:
                # 從 GitHub 取得最新資料
                github_data = await fetch_repo_data(repo.owner, repo.name)

                if github_data:
                    # 原子性地更新中繼資料 + 快照 + 訊號
                    update_repo_from_github(repo, github_data, db)

                    success_count += 1
                    logger.debug(f"[排程] 已抓取 {repo.full_name}")
                else:
                    error_count += 1
                    logger.warning(f"[排程] 抓取 {repo.full_name} 資料失敗")

            except Exception as e:
                error_count += 1
                db.rollback()
                logger.error(f"[排程] 抓取 {repo.full_name} 失敗: {e}", exc_info=True)

        logger.info(
            f"[排程] 排程抓取完成: {success_count} 成功、"
            f"{error_count} 失敗、{skipped_count} 跳過 (近期已抓取)"
        )

    except Exception as e:
        logger.error(f"[排程] 排程任務錯誤: {e}", exc_info=True)
    finally:
        db.close()


def check_alerts_job():
    """
    背景工作：檢查警報規則並觸發通知。
    在資料抓取後執行。
    """
    logger.info("[排程] 正在檢查警報規則...")

    # 在此 import 以避免循環引用
    try:
        from services.alerts import check_all_alerts
    except ImportError:
        # alerts 服務尚未實作
        logger.debug("[排程] 警報服務尚未可用")
        return

    db: Session = SessionLocal()
    try:
        triggered = check_all_alerts(db)

        if triggered:
            logger.info(f"[排程] 已觸發 {len(triggered)} 個警報")
        else:
            logger.debug("[排程] 無警報觸發")

    except Exception as e:
        logger.error(f"[排程] 檢查警報失敗: {e}", exc_info=True)
    finally:
        db.close()


async def fetch_context_signals_job():
    """
    背景工作：為所有 repo 抓取情境訊號。
    從 Hacker News 抓取並執行清理。
    """
    logger.info("[排程] 開始排程抓取上下文訊號...")

    db: Session = SessionLocal()
    try:
        result = await fetch_all_context_signals(db)
        logger.info(
            f"[排程] 上下文訊號抓取完成: "
            f"HN={result['new_hn_signals']}、"
            f"錯誤={result['errors']}"
        )

        # 執行清理以防止無限成長
        from services.context_fetcher import cleanup_old_context_signals
        cleanup_stats = cleanup_old_context_signals(db)
        if cleanup_stats["deleted_by_age"] > 0 or cleanup_stats["deleted_by_limit"] > 0:
            logger.info(f"[排程] 上下文訊號清理: {cleanup_stats}")
    except Exception as e:
        logger.error(f"[排程] 上下文訊號任務錯誤: {e}", exc_info=True)
    finally:
        db.close()


def start_scheduler(fetch_interval_minutes: int = 60):
    """
    啟動背景排程器。

    Args:
        fetch_interval_minutes: 資料抓取頻率（預設 60 分鐘）
    """
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("[排程] 排程器已在執行中")
        return

    # 新增抓取工作
    scheduler.add_job(
        fetch_all_repos_job,
        trigger=IntervalTrigger(minutes=fetch_interval_minutes),
        id="fetch_all_repos",
        name="Fetch all repos from GitHub",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping runs
    )

    # 新增警報檢查工作（抓取後 1 分鐘執行）
    scheduler.add_job(
        check_alerts_job,
        trigger=IntervalTrigger(
            minutes=fetch_interval_minutes,
            start_date=utc_now() + timedelta(minutes=1),
        ),
        id="check_alerts",
        name="Check alert rules",
        replace_existing=True,
        max_instances=1,
    )

    # 新增情境訊號工作（每 30 分鐘執行）
    scheduler.add_job(
        fetch_context_signals_job,
        trigger=IntervalTrigger(minutes=CONTEXT_FETCH_INTERVAL_MINUTES),
        id="fetch_context_signals",
        name="Fetch context signals (HN)",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    logger.info(
        f"[排程] 排程器已啟動: 資料抓取每 {fetch_interval_minutes} 分鐘、"
        f"上下文訊號每 {CONTEXT_FETCH_INTERVAL_MINUTES} 分鐘"
    )


def stop_scheduler():
    """停止背景排程器。"""
    scheduler = get_scheduler()

    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[排程] 排程器已停止")


def get_scheduler_status() -> dict:
    """取得目前排程器狀態。"""
    scheduler = get_scheduler()

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })

    return {
        "running": scheduler.running,
        "jobs": jobs,
    }


async def trigger_fetch_now():
    """手動觸發立即抓取所有 repo 與情境訊號。"""
    logger.info("[排程] 手動抓取已觸發")
    await fetch_all_repos_job()
    # 在執行緒中執行同步警報檢查以避免阻塞 event loop
    await asyncio.to_thread(check_alerts_job)
    # 同時抓取 HN 情境訊號
    await fetch_context_signals_job()
