"""
Scheduler API endpoints for managing background jobs.
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
    """Configuration for the scheduler."""
    fetch_interval_minutes: int = 60


class SchedulerStatus(BaseModel):
    """Scheduler status response."""
    running: bool
    jobs: list


@router.get("/status", response_model=SchedulerStatus)
async def get_status():
    """Get the current scheduler status."""
    return get_scheduler_status()


@router.post("/start")
async def start(config: SchedulerConfig = SchedulerConfig()):
    """Start the scheduler with the given configuration."""
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
    """Stop the scheduler."""
    try:
        stop_scheduler()
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-now")
async def fetch_now():
    """Trigger an immediate fetch of all repos."""
    try:
        await trigger_fetch_now()
        return {"status": "fetch_triggered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
