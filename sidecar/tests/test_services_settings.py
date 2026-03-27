"""
Tests for services/settings.py - Application settings service.
"""

import pytest
from unittest.mock import patch, MagicMock

from services.settings import get_setting, set_setting, delete_setting
from db.models import AppSetting


class TestGetSetting:
    """Tests for get_setting function."""

    def test_returns_value_when_exists(self, test_db):
        """Test returns setting value when it exists."""
        setting = AppSetting(key="test_key", value="test_value")
        test_db.add(setting)
        test_db.commit()

        result = get_setting("test_key", test_db)
        assert result == "test_value"

    def test_returns_none_when_not_exists(self, test_db):
        """Test returns None when setting doesn't exist."""
        result = get_setting("nonexistent_key", test_db)
        assert result is None

    def test_creates_session_when_none_provided(self):
        """Test creates new session when db is None."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_session.return_value = mock_db

            result = get_setting("some_key")

            mock_session.assert_called_once()
            mock_db.close.assert_called_once()
            assert result is None

    def test_closes_session_on_exception(self):
        """Test session is closed even when exception occurs."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_db.query.side_effect = Exception("DB Error")
            mock_session.return_value = mock_db

            with pytest.raises(Exception, match="DB Error"):
                get_setting("some_key")

            mock_db.close.assert_called_once()


class TestSetSetting:
    """Tests for set_setting function."""

    def test_creates_new_setting(self, test_db):
        """Test creates new setting when doesn't exist."""
        set_setting("new_key", "new_value", test_db)

        result = test_db.query(AppSetting).filter(AppSetting.key == "new_key").first()
        assert result is not None
        assert result.value == "new_value"

    def test_updates_existing_setting(self, test_db):
        """Test updates existing setting."""
        setting = AppSetting(key="existing_key", value="old_value")
        test_db.add(setting)
        test_db.commit()

        set_setting("existing_key", "new_value", test_db)

        result = test_db.query(AppSetting).filter(AppSetting.key == "existing_key").first()
        assert result.value == "new_value"

    def test_creates_session_when_none_provided(self):
        """Test creates new session when db is None."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_session.return_value = mock_db

            set_setting("key", "value")

            mock_session.assert_called_once()
            mock_db.add.assert_called_once()
            mock_db.commit.assert_called_once()
            mock_db.close.assert_called_once()

    def test_rollback_on_exception(self):
        """Test rollback is called on exception."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_db.commit.side_effect = Exception("Commit failed")
            mock_session.return_value = mock_db

            with pytest.raises(Exception, match="Commit failed"):
                set_setting("key", "value")

            mock_db.rollback.assert_called()  # 函式 + _ensure_db 各呼叫一次
            mock_db.close.assert_called_once()


class TestDeleteSetting:
    """Tests for delete_setting function."""

    def test_deletes_existing_setting(self, test_db):
        """Test deletes setting when it exists."""
        setting = AppSetting(key="to_delete", value="value")
        test_db.add(setting)
        test_db.commit()

        result = delete_setting("to_delete", test_db)

        assert result is True
        deleted = test_db.query(AppSetting).filter(AppSetting.key == "to_delete").first()
        assert deleted is None

    def test_returns_false_when_not_exists(self, test_db):
        """Test returns False when setting doesn't exist."""
        result = delete_setting("nonexistent_key", test_db)
        assert result is False

    def test_creates_session_when_none_provided(self):
        """Test creates new session when db is None."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_setting = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = mock_setting
            mock_session.return_value = mock_db

            result = delete_setting("key")

            mock_session.assert_called_once()
            mock_db.delete.assert_called_once_with(mock_setting)
            mock_db.commit.assert_called_once()
            mock_db.close.assert_called_once()
            assert result is True

    def test_rollback_on_exception(self):
        """Test rollback is called on exception."""
        with patch('services.settings.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_setting = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = mock_setting
            mock_db.commit.side_effect = Exception("Delete failed")
            mock_session.return_value = mock_db

            with pytest.raises(Exception, match="Delete failed"):
                delete_setting("key")

            mock_db.rollback.assert_called()  # 函式 + _ensure_db 各呼叫一次
            mock_db.close.assert_called_once()


class TestGetSettingToken:
    """Tests for get_setting with GITHUB_TOKEN (keyring integration)."""

    def test_token_from_keyring(self):
        """Test reads GITHUB_TOKEN from keyring first."""
        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.get_password.return_value = "ghp_keyring_token"

            result = get_setting("github_token")

            mock_keyring.get_password.assert_called_once_with("starscope", "github_token")
            assert result == "ghp_keyring_token"

    def test_token_keyring_error_falls_back_to_db(self, test_db):
        """Test falls back to DB when keyring raises KeyringError."""
        from keyring.errors import KeyringError

        setting = AppSetting(key="github_token", value="ghp_db_token")
        test_db.add(setting)
        test_db.commit()

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.get_password.side_effect = KeyringError("No backend")
            # Also mock set_password to prevent migration attempt
            mock_keyring.set_password.side_effect = KeyringError("No backend")

            with pytest.raises(RuntimeError, match="Token 遷移失敗"):
                get_setting("github_token", test_db)

    def test_token_migration_from_db_to_keyring(self, test_db):
        """Test migrates token from DB to keyring when found in DB but not keyring."""
        setting = AppSetting(key="github_token", value="ghp_migrate_me")
        test_db.add(setting)
        test_db.commit()

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.get_password.side_effect = [None, "ghp_migrate_me"]

            result = get_setting("github_token", test_db)

            mock_keyring.set_password.assert_called_once_with(
                "starscope", "github_token", "ghp_migrate_me"
            )
            assert result == "ghp_migrate_me"
            # Verify DB record was deleted
            db_record = test_db.query(AppSetting).filter(
                AppSetting.key == "github_token"
            ).first()
            assert db_record is None

    def test_token_migration_verification_failure(self, test_db):
        """Test migration fails when keyring stored value doesn't match."""
        setting = AppSetting(key="github_token", value="ghp_original")
        test_db.add(setting)
        test_db.commit()

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.get_password.side_effect = [None, "ghp_different"]

            with pytest.raises(RuntimeError, match="Token 遷移失敗"):
                get_setting("github_token", test_db)


class TestSetSettingToken:
    """Tests for set_setting with GITHUB_TOKEN (keyring integration)."""

    def test_set_token_stores_in_keyring(self, test_db):
        """Test stores GITHUB_TOKEN in keyring, not DB."""
        keyring_store: dict[tuple[str, str], str] = {}

        def fake_set(service: str, key: str, val: str) -> None:
            keyring_store[(service, key)] = val

        def fake_get(service: str, key: str) -> str | None:
            return keyring_store.get((service, key))

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.set_password.side_effect = fake_set
            mock_keyring.get_password.side_effect = fake_get

            set_setting("github_token", "ghp_new_token", test_db)

            mock_keyring.set_password.assert_called_once_with(
                "starscope", "github_token", "ghp_new_token"
            )
            # Verify NOT stored in DB
            db_record = test_db.query(AppSetting).filter(
                AppSetting.key == "github_token"
            ).first()
            assert db_record is None

    def test_set_token_keyring_verification_failure(self):
        """Test raises when keyring stored value doesn't match."""
        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.get_password.return_value = "wrong_value"

            with pytest.raises(ValueError, match="Keyring 驗證失敗"):
                set_setting("github_token", "ghp_correct")

    def test_set_token_keyring_error(self):
        """Test raises when keyring fails."""
        from keyring.errors import KeyringError

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.set_password.side_effect = KeyringError("Access denied")

            with pytest.raises(KeyringError):
                set_setting("github_token", "ghp_token")


class TestDeleteSettingToken:
    """Tests for delete_setting with GITHUB_TOKEN (keyring integration)."""

    def test_delete_token_from_keyring(self, test_db):
        """Test deletes GITHUB_TOKEN from both keyring and DB."""
        setting = AppSetting(key="github_token", value="old")
        test_db.add(setting)
        test_db.commit()

        with patch('services.settings.keyring') as mock_keyring:
            result = delete_setting("github_token", test_db)

            mock_keyring.delete_password.assert_called_once_with(
                "starscope", "github_token"
            )
            assert result is True

    def test_delete_token_password_delete_error(self, test_db):
        """Test handles PasswordDeleteError gracefully (token not in keyring)."""
        from keyring.errors import PasswordDeleteError

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.delete_password.side_effect = PasswordDeleteError("Not found")

            result = delete_setting("github_token", test_db)

            # Should still return False (not found in DB either)
            assert result is False

    def test_delete_token_keyring_error(self, test_db):
        """Test handles KeyringError gracefully during delete."""
        from keyring.errors import KeyringError

        with patch('services.settings.keyring') as mock_keyring:
            mock_keyring.delete_password.side_effect = KeyringError("Backend error")

            result = delete_setting("github_token", test_db)

            # Not found in DB, keyring error - returns False
            assert result is False
