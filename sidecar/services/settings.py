"""應用程式設定服務，管理鍵值對設定與 Keyring 整合。"""

import logging
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
import keyring
from keyring.errors import PasswordDeleteError, KeyringError

from db.models import AppSetting, AppSettingKey
from db.database import SessionLocal

logger = logging.getLogger(__name__)

SERVICE_NAME = "starscope"


def _is_token_key(key: str) -> bool:
    """檢查 key 是否為敏感 token。"""
    return key == AppSettingKey.GITHUB_TOKEN


def get_setting(key: str, db: Optional[Session] = None) -> Optional[str]:
    """
    依 key 取得設定值。
    GITHUB_TOKEN 優先從 Keyring 取得，再從 DB 取得（若找到則自動遷移）。
    """
    # GITHUB_TOKEN 使用 Keyring 特殊處理
    if _is_token_key(key):
        try:
            token = keyring.get_password(SERVICE_NAME, key)
            if token:
                return token
        except KeyringError as e:
            logger.warning(f"[設定] 存取 keyring 失敗 ({key}): {e}")
        except Exception as e:
            logger.critical(f"[設定] 存取 keyring 未預期錯誤 ({key}): {e}", exc_info=True)

    # 回退至 DB（或非 token 設定）
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        # noinspection PyTypeChecker
        value: Optional[str] = setting.value if setting else None

        # 遷移邏輯：若在 DB 找到 token 但 Keyring 中沒有，則遷移！
        if value and _is_token_key(key):
            try:
                logger.debug("[設定] 遷移敏感設定至安全儲存")
                keyring.set_password(SERVICE_NAME, key, value)

                # 刪除前先驗證是否已儲存
                stored_value = keyring.get_password(SERVICE_NAME, key)
                if stored_value != value:
                    db.rollback()
                    raise ValueError("Keyring 驗證失敗：儲存的值與原始值不一致")

                db.delete(setting)
                db.commit()
                logger.info(f"[設定] Token {key} 成功遷移至 Keyring")
            except (KeyringError, SQLAlchemyError, ValueError) as e:
                db.rollback()
                logger.error(f"[設定] Token 遷移失敗: {e}", exc_info=True)
                raise RuntimeError(f"Token 遷移失敗: {e}") from e
            except Exception as e:
                db.rollback()
                logger.critical(f"[設定] Token 遷移未預期錯誤: {e}", exc_info=True)
                raise RuntimeError(f"Token 遷移未預期錯誤: {e}") from e

        return value
    finally:
        if close_db:
            db.close()


def set_setting(key: str, value: str, db: Optional[Session] = None) -> None:
    """
    設定一個設定值。
    GITHUB_TOKEN 儲存至 Keyring 並從 DB 刪除。
    """
    # GITHUB_TOKEN 使用 Keyring 特殊處理
    if _is_token_key(key):
        try:
            keyring.set_password(SERVICE_NAME, key, value)

            # 驗證儲存成功
            stored_value = keyring.get_password(SERVICE_NAME, key)
            if stored_value != value:
                raise ValueError("Keyring 驗證失敗：儲存的值與原始值不一致")

            # 確保刪除 DB 中的舊值
            delete_setting_from_db(key, db)
            logger.debug(f"[設定] 敏感設定 '{key}' 已成功儲存至安全儲存")
            return
        except (KeyringError, ValueError, SQLAlchemyError) as e:
            logger.error(f"[設定] 儲存 {key} 至 keyring 失敗: {e}", exc_info=True)
            raise
        except Exception as e:
            logger.critical(f"[設定] 儲存 {key} 至 keyring 未預期錯誤: {e}", exc_info=True)
            raise

    # 一般 DB 路徑
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
        logger.info(f"[設定] 設定 '{key}' 已成功儲存")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"[設定] 儲存設定 '{key}' 資料庫錯誤: {e}", exc_info=True)
        raise
    except Exception as e:
        db.rollback()
        logger.critical(f"[設定] 儲存設定 '{key}' 未預期錯誤: {e}", exc_info=True)
        raise
    finally:
        if close_db:
            db.close()


def delete_setting(key: str, db: Optional[Session] = None) -> bool:
    """
    依 key 刪除設定。
    GITHUB_TOKEN 同時從 Keyring 與 DB 刪除。
    """
    deleted = False

    # 若為 token 則從 Keyring 刪除
    if _is_token_key(key):
        try:
            keyring.delete_password(SERVICE_NAME, key)
            deleted = True
            logger.info(f"[設定] 設定 '{key}' 已從 Keyring 刪除")
        except PasswordDeleteError:
            # Keyring 中找不到密碼
            pass
        except KeyringError as e:
            logger.warning(f"[設定] 刪除 {key} 時存取 keyring 失敗: {e}")
        except Exception as e:
            logger.critical(f"[設定] 刪除 {key} 時 keyring 未預期錯誤: {e}", exc_info=True)

    # 從 DB 刪除
    db_deleted = delete_setting_from_db(key, db)
    return deleted or db_deleted


def delete_setting_from_db(key: str, db: Optional[Session] = None) -> bool:
    """無論 key 存取方式如何，皆從 DB 刪除的輔助函式。"""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        setting = db.query(AppSetting).filter(AppSetting.key == key).first()
        if setting:
            db.delete(setting)
            db.commit()
            logger.info(f"[設定] 設定 '{key}' 已從資料庫刪除")
            return True
        return False
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"[設定] 從資料庫刪除設定 '{key}' 資料庫錯誤: {e}", exc_info=True)
        raise
    except Exception as e:
        db.rollback()
        logger.critical(f"[設定] 從資料庫刪除設定 '{key}' 未預期錯誤: {e}", exc_info=True)
        raise
    finally:
        if close_db:
            db.close()
