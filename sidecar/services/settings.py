"""
Application settings service.
Handles reading and writing app settings to the database.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from db.models import AppSetting
from db.database import SessionLocal

logger = logging.getLogger(__name__)


def get_setting(key: str, db: Optional[Session] = None) -> Optional[str]:
    """
    Get a setting value by key.

    Args:
        key: The setting key
        db: Optional database session. If not provided, creates a new one.

    Returns:
        The setting value or None if not found.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        return setting.value if setting else None
    finally:
        if close_db:
            db.close()


def set_setting(key: str, value: str, db: Optional[Session] = None) -> None:
    """
    Set a setting value. Creates new entry if doesn't exist, updates if it does.

    Args:
        key: The setting key
        value: The setting value
        db: Optional database session. If not provided, creates a new one.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        if setting:
            setting.value = value
        else:
            setting = AppSetting(key=key, value=value)
            db.add(setting)
        db.commit()
        logger.info(f"Setting '{key}' saved successfully")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to save setting '{key}': {e}")
        raise
    finally:
        if close_db:
            db.close()


def delete_setting(key: str, db: Optional[Session] = None) -> bool:
    """
    Delete a setting by key.

    Args:
        key: The setting key to delete
        db: Optional database session. If not provided, creates a new one.

    Returns:
        True if the setting was deleted, False if it didn't exist.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        if setting:
            db.delete(setting)
            db.commit()
            logger.info(f"Setting '{key}' deleted successfully")
            return True
        return False
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete setting '{key}': {e}")
        raise
    finally:
        if close_db:
            db.close()
