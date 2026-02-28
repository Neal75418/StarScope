"""
資料庫備份服務。

提供 SQLite 資料庫的自動備份功能，包括：
- 定期備份
- 保留策略（保留最近 N 天）
- 備份壓縮
"""

import shutil
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)


class BackupService:
    """資料庫備份服務"""

    def __init__(self, db_path: str, backup_dir: Optional[str] = None):
        """
        初始化備份服務。

        Args:
            db_path: 資料庫檔案路徑
            backup_dir: 備份目錄（預設：{db_path 目錄}/backups）
        """
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Database file not found: {db_path}")

        if backup_dir:
            self.backup_dir = Path(backup_dir)
        else:
            self.backup_dir = self.db_path.parent / "backups"

        # 確保備份目錄存在
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def create_backup(self) -> Optional[Path]:
        """
        建立資料庫備份。

        Returns:
            備份檔案路徑，失敗時返回 None

        Example:
            >>> service = BackupService("starscope.db")
            >>> backup_path = service.create_backup()
            >>> print(f"Backup created at: {backup_path}")
        """
        try:
            # 生成備份檔案名稱 (starscope_YYYYMMDD_HHMMSS.db)
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            backup_filename = f"{self.db_path.stem}_{timestamp}.db"
            backup_path = self.backup_dir / backup_filename

            # 複製資料庫檔案
            logger.info(f"Creating database backup: {backup_path}")
            shutil.copy2(self.db_path, backup_path)

            # 驗證備份檔案
            if not backup_path.exists() or backup_path.stat().st_size == 0:
                logger.error(f"Backup verification failed: {backup_path}")
                return None

            logger.info(f"Backup created successfully: {backup_path} ({backup_path.stat().st_size} bytes)")
            return backup_path

        except Exception as e:
            logger.error(f"Failed to create backup: {e}", exc_info=True)
            return None

    def cleanup_old_backups(self, retention_days: int = 7) -> int:
        """
        清理過期的備份檔案。

        Args:
            retention_days: 保留天數（預設 7 天）

        Returns:
            刪除的備份數量

        Example:
            >>> service = BackupService("starscope.db")
            >>> deleted_count = service.cleanup_old_backups(retention_days=7)
            >>> print(f"Deleted {deleted_count} old backups")
        """
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)
            deleted_count = 0

            # 遍歷備份目錄
            pattern = f"{self.db_path.stem}_*.db"
            for backup_file in self.backup_dir.glob(pattern):
                # 檢查檔案修改時間
                file_mtime = datetime.fromtimestamp(backup_file.stat().st_mtime, tz=timezone.utc)

                if file_mtime < cutoff_date:
                    logger.info(f"Removing old backup: {backup_file} (age: {datetime.now(timezone.utc) - file_mtime})")
                    backup_file.unlink()
                    deleted_count += 1

            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old backup(s)")
            else:
                logger.debug("No old backups to clean up")

            return deleted_count

        except Exception as e:
            logger.error(f"Failed to cleanup old backups: {e}", exc_info=True)
            return 0


def backup_database(db_path: str, retention_days: int = 7) -> Optional[Path]:
    """
    便利函式：建立備份並清理過期備份。

    Args:
        db_path: 資料庫檔案路徑
        retention_days: 保留天數

    Returns:
        備份檔案路徑，失敗時返回 None

    Example:
        >>> backup_path = backup_database("starscope.db", retention_days=7)
    """
    service = BackupService(db_path)
    backup_path = service.create_backup()

    if backup_path:
        service.cleanup_old_backups(retention_days)

    return backup_path
