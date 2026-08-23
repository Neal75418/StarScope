"""Tests for services/backup.py — BackupService & backup_database."""

import sqlite3
import time
from pathlib import Path

import pytest

from services.backup import BackupService, backup_database


@pytest.fixture
def temp_db(tmp_path):
    """建立一個真實 SQLite DB 用於測試（sqlite3.backup() 需要有效的 SQLite 檔案）。"""
    db_file = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO test VALUES (1, 'hello')")
    conn.commit()
    conn.close()
    return db_file


@pytest.fixture
def backup_dir(tmp_path):
    """備份目錄。"""
    d = tmp_path / "backups"
    d.mkdir()
    return d


@pytest.fixture
def service(temp_db, backup_dir):
    """建立 BackupService 實例。"""
    return BackupService(str(temp_db), str(backup_dir))


# ── BackupService.__init__ ────────────────────────────────


class TestBackupServiceInit:
    def test_raises_on_missing_db(self, tmp_path):
        """DB 檔案不存在時應拋出 FileNotFoundError。"""
        with pytest.raises(FileNotFoundError):
            BackupService(str(tmp_path / "nonexistent.db"))

    def test_creates_default_backup_dir(self, temp_db):
        """未指定 backup_dir 時應在 DB 同目錄下建立 backups/。"""
        svc = BackupService(str(temp_db))
        assert svc.backup_dir == temp_db.parent / "backups"
        assert svc.backup_dir.exists()

    def test_uses_custom_backup_dir(self, temp_db, backup_dir):
        """指定 backup_dir 時應使用該目錄。"""
        svc = BackupService(str(temp_db), str(backup_dir))
        assert svc.backup_dir == backup_dir


# ── create_backup ─────────────────────────────────────────


class TestCreateBackup:
    def test_creates_backup_file(self, service, backup_dir):
        """應建立備份檔案並回傳路徑。"""
        result = service.create_backup()

        assert result is not None
        assert result.exists()
        assert result.parent == backup_dir
        assert result.name.startswith("test_")
        assert result.name.endswith(".db")

    def test_backup_content_matches(self, service, temp_db):
        """備份內容應與原始 DB 一致（透過 sqlite3 查詢驗證）。"""
        result = service.create_backup()

        conn = sqlite3.connect(str(result))
        rows = conn.execute("SELECT id, value FROM test").fetchall()
        conn.close()
        assert rows == [(1, "hello")]

    def test_backup_is_isolated_from_subsequent_writes(self, service, temp_db):
        """備份應為時間點快照，後續寫入不應影響備份內容。"""
        result = service.create_backup()

        # Write a new row to the source DB after backup
        conn_src = sqlite3.connect(str(temp_db))
        conn_src.execute("INSERT INTO test VALUES (2, 'world')")
        conn_src.commit()
        conn_src.close()

        # Backup should NOT contain the new row
        conn_bak = sqlite3.connect(str(result))
        rows = conn_bak.execute("SELECT id, value FROM test").fetchall()
        conn_bak.close()
        assert rows == [(1, "hello")]

    def test_multiple_backups_unique_names(self, service):
        """多次備份應產生不同檔案名稱。"""
        from unittest.mock import patch
        from datetime import datetime, timezone

        t1 = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2024, 1, 1, 12, 0, 1, tzinfo=timezone.utc)

        with patch('services.backup.datetime') as mock_dt:
            mock_dt.now.side_effect = [t1, t2]
            b1 = service.create_backup()
            b2 = service.create_backup()

        assert b1 != b2
        assert b1.exists()
        assert b2.exists()


# ── cleanup_old_backups ───────────────────────────────────


class TestCleanupOldBackups:
    def test_removes_old_backups(self, service, backup_dir, temp_db):
        """應刪除超過保留天數的備份。"""
        # 建立一個「舊」備份（修改 mtime）
        old_backup = backup_dir / "test_20200101_000000.db"
        old_backup.write_text("old-backup")
        import os
        old_time = time.time() - 86400 * 30  # 30 天前
        os.utime(old_backup, (old_time, old_time))

        # 建立一個「新」備份
        new_backup = service.create_backup()

        deleted = service.cleanup_old_backups(retention_days=7)

        assert deleted == 1
        assert not old_backup.exists()
        assert new_backup.exists()

    def test_keeps_recent_backups(self, service):
        """不應刪除保留期限內的備份。"""
        service.create_backup()

        deleted = service.cleanup_old_backups(retention_days=7)

        assert deleted == 0

    def test_returns_zero_on_empty_dir(self, service):
        """空目錄時應回傳 0。"""
        deleted = service.cleanup_old_backups()
        assert deleted == 0


# ── backup_database 便利函式 ──────────────────────────────


class TestBackupDatabase:
    def test_creates_and_cleans(self, temp_db):
        """便利函式應建立備份並清理舊備份。"""
        result = backup_database(str(temp_db), retention_days=7)

        assert result is not None
        assert result.exists()

    def test_raises_on_missing_db(self, tmp_path):
        """DB 不存在時應拋出例外。"""
        with pytest.raises(FileNotFoundError):
            backup_database(str(tmp_path / "missing.db"))


class TestFindLatestBackup:
    """
    診斷頁的「最近備份」要看檔案系統，不是記憶體旗標。

    原本讀 _scheduler_health["last_backup"]，那是記憶體狀態、重啟就歸零；
    而備份是每天凌晨兩點的 cron。2026-08-23 實測：當天 02:00 成功備份了
    （starscope_20260822_180000.db 就在目錄裡），但因為之後重開過 App，
    畫面顯示「—」——告訴使用者沒有備份，實際上有一個 12 小時前的。
    """

    def _make(self, tmp_path, *names):
        db = tmp_path / "starscope.db"
        db.write_bytes(b"x")
        backups = tmp_path / "backups"
        backups.mkdir()
        for n in names:
            (backups / n).write_bytes(b"x")
        return str(db)

    def test_returns_newest_of_several(self, tmp_path):
        from datetime import datetime, timezone
        from services.backup import find_latest_backup

        db = self._make(tmp_path,
                        "starscope_20260821_180000.db",
                        "starscope_20260822_180000.db",
                        "starscope_20260820_180000.db")

        assert find_latest_backup(db) == datetime(2026, 8, 22, 18, 0, tzinfo=timezone.utc)

    def test_no_backups_returns_none(self, tmp_path):
        from services.backup import find_latest_backup

        assert find_latest_backup(self._make(tmp_path)) is None

    def test_missing_directory_returns_none(self, tmp_path):
        from services.backup import find_latest_backup

        db = tmp_path / "starscope.db"
        db.write_bytes(b"x")

        assert find_latest_backup(str(db)) is None

    def test_ignores_files_that_are_not_app_backups(self, tmp_path):
        """使用者自己丟進去的東西不算——那不是這個 App 產生的備份。"""
        from services.backup import find_latest_backup

        db = self._make(tmp_path,
                        "starscope_20260821_180000.db",
                        "starscope_manual_copy.db",
                        "something_20991231_235959.db")
        result = find_latest_backup(db)

        from datetime import datetime, timezone
        assert result == datetime(2026, 8, 21, 18, 0, tzinfo=timezone.utc), (
            "撿到了不是 create_backup 產生的檔案"
        )

    def test_ignores_directories(self, tmp_path):
        """我手動建的 pre-feed-regen-* 是目錄，不該被當成備份檔。"""
        from services.backup import find_latest_backup

        db = self._make(tmp_path, "starscope_20260821_180000.db")
        (tmp_path / "backups" / "starscope_20991231_235959.db").mkdir()

        from datetime import datetime, timezone
        assert find_latest_backup(db) == datetime(2026, 8, 21, 18, 0, tzinfo=timezone.utc)

    def test_time_comes_from_filename_not_mtime(self, tmp_path):
        """
        mtime 會被複製／同步工具改掉，檔名是備份當下寫死的。
        """
        import os
        from datetime import datetime, timezone
        from services.backup import find_latest_backup

        db = self._make(tmp_path, "starscope_20260821_180000.db")
        # 把 mtime 改成很久以後——若讀 mtime，結果會跟著跑掉
        future = datetime(2030, 1, 1, tzinfo=timezone.utc).timestamp()
        os.utime(tmp_path / "backups" / "starscope_20260821_180000.db", (future, future))

        assert find_latest_backup(db) == datetime(2026, 8, 21, 18, 0, tzinfo=timezone.utc)


class TestWriteReadRoundTrip:
    """create_backup 寫出來的檔案，find_latest_backup 必須找得到。

    本檔其他測試都是手工拼檔名（starscope_20260822_180000.db）來驗讀取端，
    等於測試自己編碼了一份格式——寫入端改了不會有任何測試變紅。實測：把
    create_backup 的 strftime 換成 "%Y-%m-%d_%H-%M-%S"，全套 776 個測試全綠，
    而 find_latest_backup 會靜默回 None，診斷頁就回到「明明有備份卻說沒有」，
    正是它當初要修的那個問題。
    """

    def test_a_freshly_created_backup_is_found(self, service, temp_db, backup_dir):
        created = service.create_backup()
        assert created is not None and created.exists()

        from services.backup import find_latest_backup

        found = find_latest_backup(str(temp_db), str(backup_dir))
        assert found is not None, "剛寫出來的備份必須找得到——找不到就是兩端格式不一致"

        # 檔名解析出的時間要對得上檔案本身，不能只是「有回傳東西」
        from datetime import datetime, timezone
        from services.backup import BACKUP_TIMESTAMP_FORMAT

        stamp = created.stem[len(temp_db.stem) + 1:]
        expected = datetime.strptime(stamp, BACKUP_TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
        assert found == expected

    def test_the_newest_of_several_real_backups_wins(self, service, temp_db, backup_dir):
        """連續建立多份，回傳的必須是最後那份。

        create_backup 的時間戳精度到秒，所以直接連做兩次可能同名；
        這裡沿用既有 test_multiple_backups_unique_names 的做法確保檔名不同。
        """
        import time

        first = service.create_backup()
        time.sleep(1.05)
        second = service.create_backup()
        assert first is not None and second is not None and first != second

        from services.backup import find_latest_backup
        from datetime import datetime, timezone
        from services.backup import BACKUP_TIMESTAMP_FORMAT

        stamp = second.stem[len(temp_db.stem) + 1:]
        expected = datetime.strptime(stamp, BACKUP_TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
        assert find_latest_backup(str(temp_db), str(backup_dir)) == expected
