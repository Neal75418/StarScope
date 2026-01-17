"""
StarScope Python Sidecar
FastAPI server providing data engine for the Tauri desktop app.
"""

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health, repos
from db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Application lifespan handler.
    Initializes database on startup.
    """
    # Startup: Initialize database
    init_db()
    yield
    # Shutdown: cleanup if needed


app = FastAPI(
    title="StarScope Engine",
    description="GitHub Project Intelligence API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration - allow Tauri frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",  # Vite dev server
        "tauri://localhost",      # Tauri production
        "https://tauri.localhost", # Tauri on Windows
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(repos.router, prefix="/api", tags=["repos"])


@app.get("/")
async def root():
    return {"message": "StarScope Engine is running"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8008,
        reload=True,  # Enable hot reload during development
    )
