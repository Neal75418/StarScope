import logging
from typing import Optional
from sqlalchemy.orm import Session
import keyring
from keyring.errors import PasswordDeleteError

from db.models import AppSetting, AppSettingKey
from db.database import SessionLocal

logger = logging.getLogger(__name__)

SERVICE_NAME = "starscope"


def _is_token_key(key: str) -> bool:
    """Check if the key is for sensitive token."""
    return key == AppSettingKey.GITHUB_TOKEN


def get_setting(key: str, db: Optional[Session] = None) -> Optional[str]:
    """
    Get a setting value by key.
    For GITHUB_TOKEN, tries Keyring first, then DB (and migrates if found).
    """
    # Specific handling for GITHUB_TOKEN using Keyring
    if _is_token_key(key):
        try:
            token = keyring.get_password(SERVICE_NAME, key)
            if token:
                return token
        except Exception as e:
            logger.warning(f"Failed to access keyring for {key}: {e}")

    # Fallback to DB (or for non-token settings)
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        value = setting.value if setting else None

        # Migration Logic: If we found token in DB but not in Keyring, move it!
        if value and _is_token_key(key):
            try:
                logger.info("Migrating GitHub token from Database to Keyring...")
                keyring.set_password(SERVICE_NAME, key, value)
                # Verify it saved before deleting
                if keyring.get_password(SERVICE_NAME, key) == value:
                    db.delete(setting)
                    db.commit()
                    logger.info("Token migration successful: Removed from DB.")
                else:
                    logger.error("Token migration failed: Keyring verification mismatch.", exc_info=True)
            except Exception as e:
                logger.error(f"Token migration failed: {e}", exc_info=True)

        return value
    finally:
        if close_db:
            db.close()


def set_setting(key: str, value: str, db: Optional[Session] = None) -> None:
    """
    Set a setting value.
    For GITHUB_TOKEN, stores in Keyring and deletes from DB.
    """
    # Specific handling for GITHUB_TOKEN using Keyring
    if _is_token_key(key):
        try:
            keyring.set_password(SERVICE_NAME, key, value)
            # Ensure we delete any legacy value from DB
            delete_setting_from_db(key, db)
            logger.info(f"Setting '{key}' saved to Keyring successfully")
            return
        except Exception as e:
            logger.error(f"Failed to save {key} to keyring: {e}", exc_info=True)
            raise

    # Normal DB path
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
        logger.error(f"Failed to save setting '{key}': {e}", exc_info=True)
        raise
    finally:
        if close_db:
            db.close()


def delete_setting(key: str, db: Optional[Session] = None) -> bool:
    """
    Delete a setting by key.
    For GITHUB_TOKEN, deletes from Keyring AND DB.
    """
    deleted = False

    # Delete from Keyring if it's a token
    if _is_token_key(key):
        try:
            keyring.delete_password(SERVICE_NAME, key)
            deleted = True
            logger.info(f"Setting '{key}' deleted from Keyring")
        except PasswordDeleteError:
            # Password not found in keyring
            pass
        except Exception as e:
            logger.warning(f"Error accessing keyring during delete {key}: {e}")

    # Delete from DB
    db_deleted = delete_setting_from_db(key, db)
    return deleted or db_deleted


def delete_setting_from_db(key: str, db: Optional[Session] = None) -> bool:
    """Helper to delete from DB regardless of key access method."""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        if setting:
            db.delete(setting)
            db.commit()
            logger.info(f"Setting '{key}' deleted from DB")
            return True
        return False
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete setting '{key}' from DB: {e}", exc_info=True)
        raise
    finally:
        if close_db:
            db.close()
