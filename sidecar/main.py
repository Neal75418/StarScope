"""
StarScope Python Sidecar
FastAPI server providing data engine for the Tauri desktop app.
"""

import os
import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from constants import DEFAULT_FETCH_INTERVAL_MINUTES, GITHUB_TOKEN_ENV_VAR
from middleware import LoggingMiddleware

# Environment configuration
DEBUG = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
ENV = os.getenv("ENV", "development")
from logging_config import setup_logging
from routers import health, repos, scheduler, alerts, trends, context, charts, health_score, tags, recommendations, categories, comparisons, early_signals, export, webhooks
from db import init_db
from services.scheduler import start_scheduler, stop_scheduler

# Configure logging before anything else
setup_logging(level="INFO")


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Application lifespan handler.
    Initializes database on startup, starts scheduler.
    """
    # Check for required environment variables
    github_token = os.getenv(GITHUB_TOKEN_ENV_VAR)
    if not github_token:
        logger.warning(
            f"Warning: {GITHUB_TOKEN_ENV_VAR} not set. "
            "GitHub API rate limits will be low (60 requests/hour). "
            "Set the environment variable for higher limits (5000 requests/hour)."
        )
    else:
        logger.info("GitHub token configured")

    # Startup: Initialize database
    init_db()

    # Start background scheduler
    start_scheduler(fetch_interval_minutes=DEFAULT_FETCH_INTERVAL_MINUTES)

    logger.info(f"StarScope Engine started (ENV={ENV}, DEBUG={DEBUG})")

    yield

    # Shutdown: stop scheduler
    stop_scheduler()
    logger.info("StarScope Engine stopped")


app = FastAPI(
    title="StarScope Engine",
    description="GitHub Project Intelligence API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration - allow Tauri frontend to call this API
# Be more specific about allowed methods and headers for security
ALLOWED_ORIGINS = [
    "http://localhost:1420",  # Vite dev server
    "tauri://localhost",      # Tauri production
    "https://tauri.localhost", # Tauri on Windows
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)

# Request/Response logging middleware
app.add_middleware(
    LoggingMiddleware,
    exclude_paths=["/api/health", "/"],
    log_headers=DEBUG,  # Only log headers in debug mode
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(repos.router, prefix="/api", tags=["repos"])
app.include_router(scheduler.router, tags=["scheduler"])
app.include_router(alerts.router, tags=["alerts"])
app.include_router(trends.router, tags=["trends"])
app.include_router(context.router, prefix="/api", tags=["context"])
app.include_router(charts.router, prefix="/api", tags=["charts"])
app.include_router(health_score.router, prefix="/api", tags=["health-score"])
app.include_router(tags.router, prefix="/api", tags=["tags"])
app.include_router(recommendations.router, prefix="/api", tags=["recommendations"])
app.include_router(categories.router, prefix="/api", tags=["categories"])
app.include_router(comparisons.router, prefix="/api", tags=["comparisons"])
app.include_router(early_signals.router, prefix="/api", tags=["early-signals"])
app.include_router(export.router, prefix="/api", tags=["export"])
app.include_router(webhooks.router, prefix="/api", tags=["webhooks"])


@app.get("/")
async def root():
    return {"message": "StarScope Engine is running"}


if __name__ == "__main__":
    # Only enable hot reload in development mode
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8008")),
        reload=DEBUG,  # Only enable hot reload when DEBUG=true
    )
