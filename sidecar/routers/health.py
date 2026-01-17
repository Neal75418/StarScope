"""
Health check router for verifying sidecar connectivity.
"""

from fastapi import APIRouter

from utils.time import utc_now

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.
    Frontend can call this to verify the Python sidecar is running.
    """
    return {
        "status": "ok",
        "service": "starscope-engine",
        "timestamp": utc_now().isoformat(),
    }
