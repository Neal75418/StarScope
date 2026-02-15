"""
排程器 API 端點，管理背景工作。
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from middleware.rate_limit import limiter
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


@router.get("/status", response_model=SchedulerStatus)
@limiter.limit("30/minute")
async def get_status(request: Request):
    """取得目前排程器狀態。"""
    return get_scheduler_status()


@router.post("/start")
@limiter.limit("5/minute")
async def start(request: Request, config: SchedulerConfig = SchedulerConfig()):
    """以指定設定啟動排程器。"""
    try:
        start_scheduler(fetch_interval_minutes=config.fetch_interval_minutes)
        return {
            "status": "started",
            "interval_minutes": config.fetch_interval_minutes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
@limiter.limit("5/minute")
async def stop(request: Request):
    """停止排程器。"""
    try:
        stop_scheduler()
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-now")
@limiter.limit("5/minute")
async def fetch_now(request: Request):
    """觸發立即抓取所有 repo。"""
    try:
        await trigger_fetch_now()
        return {"status": "fetch_triggered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
