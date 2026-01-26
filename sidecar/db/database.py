"""
SQLite database connection and session management.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def get_app_data_dir() -> Path:
    """
    Get OS-standard app data directory, overridable via environment variables.

    Priority:
    1. STARSCOPE_DATA_DIR - explicit override for testing/custom paths
    2. TAURI_APP_DATA_DIR - injected by Tauri for production
    3. Fallback to ~/.starscope for development
    """
    if env_path := os.environ.get("STARSCOPE_DATA_DIR"):
        return Path(env_path)

    if tauri_path := os.environ.get("TAURI_APP_DATA_DIR"):
        return Path(tauri_path)

    # Fallback for development
    return Path.home() / ".starscope"


# Database file location
APP_DATA_DIR = get_app_data_dir()
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = APP_DATA_DIR / "starscope.db"

# SQLite connection URL
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Create engine with SQLite-specific settings
engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,  # Required for SQLite with FastAPI
        "timeout": 30,  # Wait up to 30s for locks (default: 5s)
    },
    pool_pre_ping=True,  # Verify connections before use
    echo=False,  # Set to True for SQL debugging
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    Dependency for FastAPI routes.
    Yields a database session and ensures it's closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Initialize the database by creating all tables.
    Should be called once when the application starts.
    """
    from .models import Base
    Base.metadata.create_all(bind=engine)
    print(f"Database initialized at: {DATABASE_PATH}")
