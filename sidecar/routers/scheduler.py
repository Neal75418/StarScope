"""
排程器 API 端點，管理背景工作。
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from middleware.rate_limit import limiter
from schemas.response import ApiResponse, StatusResponse, success_response
from services.scheduler import (
    get_scheduler_status,
    start_scheduler,
    stop_scheduler,
    trigger_fetch_now,
)

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


class SchedulerConfig(BaseModel):
    """排程器設定。"""
    fetch_interval_minutes: int = 60


class ScheduledJob(BaseModel):
    """排程工作資訊。"""
    id: str
    name: str
    next_run: Optional[str] = None


class SchedulerStatus(BaseModel):
    """排程器狀態回應。"""
    running: bool
    jobs: List[ScheduledJob]


@router.get("/status", response_model=ApiResponse[SchedulerStatus])
@limiter.limit("30/minute")
async def get_status(request: Request):
    """取得目前排程器狀態。"""
    _ = request  # 由 @limiter.limit decorator 隱式使用
    return success_response(data=get_scheduler_status())


@router.post("/start", response_model=ApiResponse[StatusResponse])
@limiter.limit("5/minute")
async def start(request: Request, config: SchedulerConfig = SchedulerConfig()):
    """以指定設定啟動排程器。"""
    _ = request  # 由 @limiter.limit decorator 隱式使用
    try:
        start_scheduler(fetch_interval_minutes=config.fetch_interval_minutes)
        return success_response(
            data=StatusResponse(status="started"),
            message=f"Scheduler started with {config.fetch_interval_minutes}min interval",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop", response_model=ApiResponse[StatusResponse])
@limiter.limit("5/minute")
async def stop(request: Request):
    """停止排程器。"""
    _ = request  # 由 @limiter.limit decorator 隱式使用
    try:
        stop_scheduler()
        return success_response(data=StatusResponse(status="stopped"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-now", response_model=ApiResponse[StatusResponse])
@limiter.limit("5/minute")
async def fetch_now(request: Request):
    """觸發立即抓取所有 repo。"""
    _ = request  # 由 @limiter.limit decorator 隱式使用
    try:
        await trigger_fetch_now()
        return success_response(data=StatusResponse(status="fetch_triggered"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
