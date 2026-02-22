"""Tests for services/backup.py — BackupService & backup_database."""

import time
from pathlib import Path

import pytest

from services.backup import BackupService, backup_database


@pytest.fixture
def temp_db(tmp_path):
    """建立一個臨時 DB 檔案用於測試。"""
    db_file = tmp_path / "test.db"
    db_file.write_text("fake-database-content")
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
        """備份內容應與原始 DB 一致。"""
        result = service.create_backup()

        assert result.read_text() == temp_db.read_text()

    def test_multiple_backups_unique_names(self, service):
        """多次備份應產生不同檔案名稱。"""
        b1 = service.create_backup()
        time.sleep(1.1)  # 確保 timestamp 不同
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


# ── list_backups ──────────────────────────────────────────


class TestListBackups:
    def test_lists_backups_sorted(self, service):
        """應按時間倒序列出所有備份。"""
        service.create_backup()
        time.sleep(1.1)
        service.create_backup()

        backups = service.list_backups()

        assert len(backups) == 2
        # 最新的在前
        assert backups[0][1] >= backups[1][1]

    def test_returns_correct_fields(self, service):
        """每個備份應包含 (path, datetime, size)。"""
        service.create_backup()
        backups = service.list_backups()

        path, created_at, size = backups[0]
        assert isinstance(path, Path)
        assert size > 0

    def test_empty_list_on_no_backups(self, service):
        """無備份時應回傳空列表。"""
        assert service.list_backups() == []


# ── restore_backup ────────────────────────────────────────


class TestRestoreBackup:
    def test_restores_backup(self, service, temp_db):
        """應成功還原備份。"""
        # 建立備份
        backup_path = service.create_backup()

        # 等待確保 safety backup 不會覆蓋原始備份（timestamp 精度為秒）
        time.sleep(1.1)

        # 修改原始 DB
        temp_db.write_text("modified-content")

        # 還原
        result = service.restore_backup(backup_path)

        assert result is True
        assert temp_db.read_text() == "fake-database-content"

    def test_creates_safety_backup_before_restore(self, service, temp_db):
        """還原前應先建立安全備份。"""
        backup_path = service.create_backup()

        # 等待確保 safety backup 有不同的 timestamp
        time.sleep(1.1)

        temp_db.write_text("current-state")
        service.restore_backup(backup_path)

        # 應有 2 個備份（原始 + 安全備份）
        backups = service.list_backups()
        assert len(backups) >= 2

    def test_fails_on_missing_backup(self, service, tmp_path):
        """備份檔案不存在時應回傳 False。"""
        result = service.restore_backup(tmp_path / "nonexistent.db")
        assert result is False


# ── backup_database 便利函式 ──────────────────────────────


class TestBackupDatabase:
    def test_creates_and_cleans(self, temp_db):
        """便利函式應建立備份並清理舊備份。"""
        result = backup_database(str(temp_db), retention_days=7)

        assert result is not None
        assert result.exists()

    def test_returns_none_on_missing_db(self, tmp_path):
        """DB 不存在時應拋出例外。"""
        with pytest.raises(FileNotFoundError):
            backup_database(str(tmp_path / "missing.db"))
