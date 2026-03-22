"""
應用程式設定 API 端點。
管理排程間隔、快照保留天數、Early Signal 偵測門檻等可設定參數。
"""

import logging
import os
import time as _time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db, DATABASE_URL
from db.models import (
    AppSettingKey,
    Repo, RepoSnapshot, Signal, AlertRule, TriggeredAlert,
    EarlySignal, ContextSignal, CommitActivity, RepoLanguage,
    SimilarRepo, RepoCategory, Category,
)
from schemas.response import ApiResponse, success_response
from services.settings import get_setting, set_setting

router = APIRouter(prefix="/api/settings", tags=["settings"])
logger = logging.getLogger(__name__)
_START_TIME = _time.monotonic()

# 允許的排程間隔（分鐘）
ALLOWED_FETCH_INTERVALS = {60, 360, 720, 1440}
DEFAULT_FETCH_INTERVAL = 60
DEFAULT_SNAPSHOT_RETENTION = 90


# --- Schema 定義 ---

class FetchIntervalResponse(BaseModel):
    interval_minutes: int


class FetchIntervalUpdate(BaseModel):
    interval_minutes: int

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval(cls, v: int) -> int:
        if v not in ALLOWED_FETCH_INTERVALS:
            raise ValueError(f"interval_minutes must be one of {sorted(ALLOWED_FETCH_INTERVALS)}")
        return v


class SnapshotRetentionResponse(BaseModel):
    retention_days: int


class SnapshotRetentionUpdate(BaseModel):
    retention_days: int

    @field_validator("retention_days")
    @classmethod
    def validate_retention(cls, v: int) -> int:
        if not (30 <= v <= 730):
            raise ValueError("retention_days must be between 30 and 730")
        return v


class SignalThresholdsResponse(BaseModel):
    rising_star_min_velocity: float
    sudden_spike_multiplier: float
    breakout_velocity_threshold: float
    viral_hn_min_score: int


class SignalThresholdsUpdate(BaseModel):
    rising_star_min_velocity: float | None = None
    sudden_spike_multiplier: float | None = None
    breakout_velocity_threshold: float | None = None
    viral_hn_min_score: int | None = None

    @field_validator("rising_star_min_velocity", "sudden_spike_multiplier", "breakout_velocity_threshold")
    @classmethod
    def validate_positive_float(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("must be greater than 0")
        return v

    @field_validator("viral_hn_min_score")
    @classmethod
    def validate_positive_int(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("must be greater than 0")
        return v


class ResetDataConfirmation(BaseModel):
    confirm: str

    @field_validator("confirm")
    @classmethod
    def validate_confirm(cls, v: str) -> str:
        if v != "RESET":
            raise ValueError("confirm must be 'RESET'")
        return v


class ResetDataResponse(BaseModel):
    status: str
    deleted_repos: int


# --- 排程間隔設定 ---

@router.get("/fetch-interval", response_model=ApiResponse[FetchIntervalResponse])
async def get_fetch_interval(db: Session = Depends(get_db)):
    """取得目前的資料抓取間隔（分鐘）。"""
    value = get_setting(AppSettingKey.FETCH_INTERVAL_MINUTES, db)
    interval = int(value) if value else DEFAULT_FETCH_INTERVAL
    return success_response(data=FetchIntervalResponse(interval_minutes=interval))


@router.put("/fetch-interval", response_model=ApiResponse[FetchIntervalResponse])
async def update_fetch_interval(body: FetchIntervalUpdate, db: Session = Depends(get_db)):
    """更新資料抓取間隔，並立即套用至排程器。"""
    set_setting(AppSettingKey.FETCH_INTERVAL_MINUTES, str(body.interval_minutes), db)

    # 立即更新排程器
    try:
        from services.scheduler import get_scheduler
        from apscheduler.triggers.interval import IntervalTrigger
        from utils.time import utc_now
        from datetime import timedelta

        scheduler = get_scheduler()
        if scheduler.running:
            scheduler.reschedule_job(
                "fetch_all_repos",
                trigger=IntervalTrigger(minutes=body.interval_minutes),
            )
            scheduler.reschedule_job(
                "check_alerts",
                trigger=IntervalTrigger(
                    minutes=body.interval_minutes,
                    start_date=utc_now() + timedelta(minutes=1),
                ),
            )
    except Exception as e:
        # 排程器更新失敗不影響設定儲存，但記錄警告
        logger.warning(f"[設定] 排程器更新失敗，將於下次重啟後生效: {e}")

    return success_response(data=FetchIntervalResponse(interval_minutes=body.interval_minutes))


# --- 快照保留設定 ---

@router.get("/snapshot-retention", response_model=ApiResponse[SnapshotRetentionResponse])
async def get_snapshot_retention(db: Session = Depends(get_db)):
    """取得快照保留天數設定。"""
    value = get_setting(AppSettingKey.SNAPSHOT_RETENTION_DAYS, db)
    days = int(value) if value else DEFAULT_SNAPSHOT_RETENTION
    return success_response(data=SnapshotRetentionResponse(retention_days=days))


@router.put("/snapshot-retention", response_model=ApiResponse[SnapshotRetentionResponse])
async def update_snapshot_retention(body: SnapshotRetentionUpdate, db: Session = Depends(get_db)):
    """更新快照保留天數。"""
    set_setting(AppSettingKey.SNAPSHOT_RETENTION_DAYS, str(body.retention_days), db)
    return success_response(data=SnapshotRetentionResponse(retention_days=body.retention_days))


# --- Early Signal 偵測門檻 ---

@router.get("/signal-thresholds", response_model=ApiResponse[SignalThresholdsResponse])
async def get_signal_thresholds(db: Session = Depends(get_db)):
    """取得 Early Signal 偵測門檻。"""
    from services.anomaly_detector import get_thresholds
    thresholds = get_thresholds(db)
    return success_response(data=SignalThresholdsResponse(**thresholds))


@router.put("/signal-thresholds", response_model=ApiResponse[SignalThresholdsResponse])
async def update_signal_thresholds(body: SignalThresholdsUpdate, db: Session = Depends(get_db)):
    """更新 Early Signal 偵測門檻。"""
    from services.anomaly_detector import save_thresholds, get_thresholds, reload_thresholds_from_db
    updates = body.model_dump(exclude_none=True)
    if updates:
        save_thresholds(updates, db)
        reload_thresholds_from_db(db)
    thresholds = get_thresholds(db)
    return success_response(data=SignalThresholdsResponse(**thresholds))


# --- 快取清除 ---

@router.post("/clear-cache", response_model=ApiResponse[dict])
async def clear_cache():
    """
    清除後端快取（目前為 no-op，實際快取清除由前端 React Query invalidation 執行）。
    """
    return success_response(data={"status": "ok"})


# --- 診斷資訊 ---

class DiagnosticsResponse(BaseModel):
    """系統診斷資訊。"""
    version: str
    db_path: str
    db_size_mb: float
    total_repos: int
    total_snapshots: int
    last_snapshot_at: str | None
    uptime_seconds: float
    last_fetch_success: str | None
    last_fetch_failure: str | None
    last_fetch_error: str | None
    last_alert_check: str | None
    last_backup: str | None


@router.get("/diagnostics", response_model=ApiResponse[DiagnosticsResponse])
async def get_diagnostics(db: Session = Depends(get_db)):
    """取得系統診斷資訊：版本、資料庫狀態、排程健康狀態。"""
    from services.scheduler import get_scheduler_health
    from datetime import datetime, timezone

    db_path_abs = DATABASE_URL.replace("sqlite:///", "")
    db_size = os.path.getsize(db_path_abs) / (1024 * 1024) if os.path.exists(db_path_abs) else 0
    # 顯示相對路徑（隱藏使用者名稱）
    home = os.path.expanduser("~")
    db_path_display = db_path_abs.replace(home, "~") if db_path_abs.startswith(home) else db_path_abs

    total_repos = db.query(func.count(Repo.id)).scalar() or 0
    total_snapshots = db.query(func.count(RepoSnapshot.id)).scalar() or 0
    last_snapshot = db.query(func.max(RepoSnapshot.snapshot_date)).scalar()

    return success_response(data=DiagnosticsResponse(
        version="0.4.0",
        db_path=db_path_display,
        db_size_mb=round(db_size, 2),
        total_repos=total_repos,
        total_snapshots=total_snapshots,
        last_snapshot_at=last_snapshot.isoformat() if last_snapshot else None,
        uptime_seconds=round(_time.monotonic() - _START_TIME, 1),
        **_format_scheduler_health(get_scheduler_health()),
    ))


def _format_scheduler_health(health: dict) -> dict:
    """將 scheduler 的 Unix timestamp 轉為 ISO 字串。"""
    from datetime import datetime, timezone

    def _ts_to_iso(ts: float | None) -> str | None:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None

    return {
        "last_fetch_success": _ts_to_iso(health.get("last_fetch_success")),
        "last_fetch_failure": _ts_to_iso(health.get("last_fetch_failure")),
        "last_fetch_error": health.get("last_fetch_error"),
        "last_alert_check": _ts_to_iso(health.get("last_alert_check")),
        "last_backup": _ts_to_iso(health.get("last_backup")),
    }


# --- 日誌匯出 ---

@router.get("/logs", response_model=ApiResponse[dict])
async def get_recent_logs():
    """取得最近的日誌條目（最多 200 行）。"""
    log_dir = os.path.join(os.path.expanduser("~"), ".starscope")
    log_file = os.path.join(log_dir, "starscope.log")

    if not os.path.exists(log_file):
        return success_response(data={"logs": "（無日誌檔案）", "path": log_file})

    try:
        with open(log_file, "r", errors="ignore") as f:
            lines = f.readlines()
        recent = "".join(lines[-200:])
        return success_response(data={"logs": recent, "path": log_file})
    except OSError as e:
        return success_response(data={"logs": f"讀取日誌失敗: {e}", "path": log_file})


# --- 重設所有資料 ---

@router.post("/reset-data", response_model=ApiResponse[ResetDataResponse])
async def reset_all_data(body: ResetDataConfirmation, db: Session = Depends(get_db)):
    """
    刪除所有追蹤資料（repos、快照、訊號、警報等）。
    保留 GitHub 憑證與應用程式設定。
    需要 body {"confirm": "RESET"} 以防止意外呼叫。
    """
    # 計算刪除前的 repo 數量
    repo_count = db.query(Repo).count()

    # 依外鍵相依順序刪除（避免外鍵約束衝突）
    db.query(TriggeredAlert).delete(synchronize_session=False)
    db.query(AlertRule).delete(synchronize_session=False)
    db.query(EarlySignal).delete(synchronize_session=False)
    db.query(ContextSignal).delete(synchronize_session=False)
    db.query(Signal).delete(synchronize_session=False)
    db.query(RepoSnapshot).delete(synchronize_session=False)
    db.query(CommitActivity).delete(synchronize_session=False)
    db.query(RepoLanguage).delete(synchronize_session=False)
    db.query(SimilarRepo).delete(synchronize_session=False)
    db.query(RepoCategory).delete(synchronize_session=False)
    db.query(Repo).delete(synchronize_session=False)
    db.query(Category).delete(synchronize_session=False)
    db.commit()

    return success_response(data=ResetDataResponse(status="reset", deleted_repos=repo_count))
