"""
SQLite database connection and session management.
"""

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Database file location
# Store in user's app data directory for persistence
APP_DATA_DIR = Path.home() / ".starscope"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = APP_DATA_DIR / "starscope.db"

# SQLite connection URL
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Create engine with SQLite-specific settings
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # Required for SQLite with FastAPI
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
