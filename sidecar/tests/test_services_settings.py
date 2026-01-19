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

            mock_db.rollback.assert_called_once()
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

            mock_db.rollback.assert_called_once()
            mock_db.close.assert_called_once()
