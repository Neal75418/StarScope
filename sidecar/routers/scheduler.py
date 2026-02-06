"""
排程器 API 端點，管理背景工作。
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


class SchedulerStatus(BaseModel):
    """排程器狀態回應。"""
    running: bool
    jobs: list


@router.get("/status", response_model=SchedulerStatus)
async def get_status():
    """取得目前排程器狀態。"""
    return get_scheduler_status()


@router.post("/start")
async def start(config: SchedulerConfig = SchedulerConfig()):
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
async def stop():
    """停止排程器。"""
    try:
        stop_scheduler()
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-now")
async def fetch_now():
    """觸發立即抓取所有 repo。"""
    try:
        await trigger_fetch_now()
        return {"status": "fetch_triggered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
