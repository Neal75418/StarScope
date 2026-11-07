"""
資料庫備份服務。

提供 SQLite 資料庫的自動備份功能，包括：
- 定期備份
- 保留策略（保留最近 N 天）
"""

from contextlib import suppress
from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path
import sqlite3

logger = logging.getLogger(__name__)


# 備份檔名裡的時間戳格式。寫入（create_backup）與讀取（find_latest_backup）共用同一個
# 常數：兩邊各寫一份的話，改了寫入端會讓讀取端靜默找不到備份，而診斷頁就會回到
# 「明明有備份卻說沒有」——那正是 find_latest_backup 當初要修的問題。
BACKUP_TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"

# 備份先寫到「正式檔名＋這個後綴」，驗證過才改名：中途失敗或行程被砍留下的檔案不符合 `{stem}_*.db`，
# find_latest_backup 與診斷頁不會把半成品當成備份
PARTIAL_SUFFIX = ".partial"


class BackupService:
    """資料庫備份服務"""

    def __init__(self, db_path: str, backup_dir: str | None = None) -> None:
        """
        初始化備份服務。

        Args:
            db_path: 資料庫檔案路徑
            backup_dir: 備份目錄（預設：{db_path 目錄}/backups）
        """
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"資料庫檔案不存在: {db_path}")

        if backup_dir:
            self.backup_dir = Path(backup_dir)
        else:
            self.backup_dir = self.db_path.parent / "backups"

        # 確保備份目錄存在
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def create_backup(self) -> Path | None:
        """
        建立資料庫備份。

        先寫到暫存檔（見 PARTIAL_SUFFIX），驗證過才改成正式檔名；失敗時刪掉暫存檔。

        Returns:
            備份檔案路徑，失敗時返回 None

        """
        # 備份檔名帶 UTC 時間戳，格式見 BACKUP_TIMESTAMP_FORMAT
        timestamp = datetime.now(timezone.utc).strftime(BACKUP_TIMESTAMP_FORMAT)
        backup_filename = f"{self.db_path.stem}_{timestamp}.db"
        backup_path = self.backup_dir / backup_filename
        # 已知限制：App 的 02:00 備份與 collector 的補跑剛好在同一秒時會共用這個暫存檔名，後完成的那邊會回報
        # 失敗。collector 只在最新備份超過 24 小時才補跑，撞上的機率極低，不另外處理
        partial_path = self.backup_dir / f"{backup_filename}{PARTIAL_SUFFIX}"

        try:
            # 使用 SQLite Online Backup API，安全處理 WAL 模式
            logger.info(f"[備份] 建立資料庫備份: {backup_path}")
            src = sqlite3.connect(str(self.db_path))
            try:
                dst = sqlite3.connect(str(partial_path))
                try:
                    src.backup(dst)
                finally:
                    dst.close()
            finally:
                src.close()

            # 驗證備份檔案
            if not partial_path.exists() or partial_path.stat().st_size == 0:
                logger.error(f"[備份] 備份驗證失敗: {backup_path}")
                self._discard(partial_path)
                return None

            partial_path.replace(backup_path)
            logger.info(f"[備份] 備份建立成功: {backup_path} ({backup_path.stat().st_size} bytes)")
            return backup_path

        # sqlite3.Error（磁碟滿、I/O 錯誤）不是 OSError：沒接住的話會往外拋，把整輪 collector 變成 FAILED
        except (OSError, sqlite3.Error) as e:
            logger.exception(f"[備份] 備份建立失敗: {e}")
            self._discard(partial_path)
            return None

    @staticmethod
    def _discard(partial_path: Path) -> None:
        """刪掉沒完成的暫存檔；刪不掉也不影響「這次備份失敗」的結果。"""
        with suppress(OSError):
            partial_path.unlink(missing_ok=True)

    def cleanup_old_backups(self, retention_days: int = 7) -> int:
        """
        清理過期的備份檔案。

        Args:
            retention_days: 保留天數（預設 7 天）

        Returns:
            刪除的檔案數（含中斷的備份留下的暫存檔）

        """
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)
            deleted_count = 0

            # 遍歷備份目錄。中途被砍的備份會留下暫存檔，寫入途中被砍還會多一個 SQLite 的 journal
            # （`.partial-journal`）：它們不算備份，但一樣過期就清掉，否則會一直累積
            pattern = f"{self.db_path.stem}_*.db"
            leftovers = set(self.backup_dir.glob(f"{pattern}{PARTIAL_SUFFIX}*"))
            for backup_file in [*self.backup_dir.glob(pattern), *leftovers]:
                # 檢查檔案修改時間
                file_mtime = datetime.fromtimestamp(backup_file.stat().st_mtime, tz=timezone.utc)

                if file_mtime < cutoff_date:
                    age = datetime.now(timezone.utc) - file_mtime
                    if backup_file in leftovers:
                        logger.info(f"[備份] 移除中斷的備份留下的暫存檔: {backup_file} (age: {age})")
                    else:
                        logger.info(f"[備份] 移除舊備份: {backup_file} (age: {age})")
                    backup_file.unlink()
                    deleted_count += 1

            if deleted_count > 0:
                logger.info(f"[備份] 清理了 {deleted_count} 個過期檔案")
            else:
                logger.debug("[備份] 無需清理舊備份")

            return deleted_count

        except OSError as e:
            logger.exception(f"[備份] 清理舊備份失敗: {e}")
            return 0


def find_latest_backup(db_path: str, backup_dir: str | None = None) -> "datetime | None":
    """
    從備份目錄找出最新一次備份的時間。

    診斷頁的「最近備份」原本讀的是 _scheduler_health["last_backup"]，那是**記憶體**
    狀態，重啟就歸零。而備份是每天凌晨兩點的 cron，所以只要當天重開過 App，
    那一格就會顯示「—」——2026-08-23 實測：當天 02:00 明明成功備份了
    （starscope_20260822_180000.db 就在目錄裡），畫面卻說沒有備份。

    改看檔案系統：它是這個問題的真正答案來源，重啟後照樣正確，
    也不需要為一個診斷顯示引入新的持久化機制。

    只認 create_backup 寫出的檔名格式（`{stem}_YYYYMMDD_HHMMSS.db`），
    使用者自己丟進去的檔案或目錄不算——那些不是這個 App 產生的備份。

    Returns:
        最新備份的建立時間（UTC），沒有任何備份時回 None
    """
    db = Path(db_path)
    directory = Path(backup_dir) if backup_dir else db.parent / "backups"
    if not directory.is_dir():
        return None

    latest: datetime | None = None
    for f in directory.glob(f"{db.stem}_*.db"):
        if not f.is_file():
            continue
        # 時間取自檔名而非 mtime：mtime 會被複製／同步工具改掉，
        # 檔名是備份當下寫死的
        stamp = f.stem[len(db.stem) + 1:]
        try:
            ts = datetime.strptime(stamp, BACKUP_TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if latest is None or ts > latest:
            latest = ts
    return latest


def backup_database(db_path: str, retention_days: int = 7) -> Path | None:
    """
    便利函式：建立備份並清理過期備份。

    Args:
        db_path: 資料庫檔案路徑
        retention_days: 保留天數

    Returns:
        備份檔案路徑，失敗時返回 None

    Example::

        backup_database("starscope.db", retention_days=7)
    """
    service = BackupService(db_path)
    backup_path = service.create_backup()

    if backup_path:
        service.cleanup_old_backups(retention_days)

    return backup_path
