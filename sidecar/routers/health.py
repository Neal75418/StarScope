"""
Health check router for verifying sidecar connectivity.
"""

from datetime import datetime
from fastapi import APIRouter

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
        "timestamp": datetime.now().isoformat(),
    }
