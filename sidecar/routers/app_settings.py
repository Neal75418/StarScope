"""
應用程式設定 API 端點。
管理排程間隔、快照保留天數、Early Signal 偵測門檻等可設定參數。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
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

# 允許的排程間隔（分鐘）
ALLOWED_FETCH_INTERVALS = {60, 360, 720, 1440}
DEFAULT_FETCH_INTERVAL = 60
DEFAULT_SNAPSHOT_RETENTION = 90


# --- Schemas ---

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
        logger.warning("排程器更新失敗，將於下次重啟後生效: %s", e)

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


# --- 重設所有資料 ---

@router.post("/reset-data", response_model=ApiResponse[ResetDataResponse])
async def reset_all_data(db: Session = Depends(get_db)):
    """
    刪除所有追蹤資料（repos、快照、訊號、警報等）。
    保留 GitHub 憑證與應用程式設定。
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
