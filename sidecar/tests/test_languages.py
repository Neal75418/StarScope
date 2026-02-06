"""
Tests for languages endpoints.
"""

from unittest.mock import patch, AsyncMock

from db.models import RepoLanguage
from utils.time import utc_now


def _create_repo_languages(test_db, repo_id):
    """Helper to create RepoLanguage records in the database."""
    now = utc_now()
    languages_data = [
        ("Python", 50000, 62.5),
        ("JavaScript", 20000, 25.0),
        ("HTML", 10000, 12.5),
    ]
    records = []
    for language, byte_count, percentage in languages_data:
        lang = RepoLanguage(
            repo_id=repo_id,
            language=language,
            bytes=byte_count,
            percentage=percentage,
            updated_at=now,
        )
        test_db.add(lang)
        records.append(lang)
    test_db.commit()
    for r in records:
        test_db.refresh(r)
    return records


class TestGetLanguages:
    """Test cases for GET /api/languages/{repo_id}."""

    def test_get_languages_has_data(self, client, test_db, mock_repo):
        """Test getting languages for a repo with existing data."""
        _create_repo_languages(test_db, mock_repo.id)

        response = client.get(f"/api/languages/{mock_repo.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["repo_name"] == mock_repo.full_name
        assert len(data["languages"]) == 3
        assert data["primary_language"] == "Python"
        assert data["total_bytes"] == 80000
        assert data["last_updated"] is not None

        # Languages should be sorted by bytes descending
        bytes_list = [lang["bytes"] for lang in data["languages"]]
        assert bytes_list == sorted(bytes_list, reverse=True)

        # Verify language structure
        first_lang = data["languages"][0]
        assert first_lang["language"] == "Python"
        assert first_lang["bytes"] == 50000
        assert first_lang["percentage"] == 62.5

    def test_get_languages_empty(self, client, mock_repo):
        """Test getting languages when not fetched yet returns 404."""
        response = client.get(f"/api/languages/{mock_repo.id}")
        assert response.status_code == 404
        data = response.json()
        assert "not fetched yet" in data["detail"].lower()

    def test_get_languages_repo_not_found(self, client):
        """Test getting languages for nonexistent repo returns 404."""
        response = client.get("/api/languages/99999")
        assert response.status_code == 404


class TestGetLanguagesSummary:
    """Test cases for GET /api/languages/{repo_id}/summary."""

    def test_get_summary_has_data(self, client, test_db, mock_repo):
        """Test getting languages summary with data."""
        _create_repo_languages(test_db, mock_repo.id)

        response = client.get(f"/api/languages/{mock_repo.id}/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["primary_language"] == "Python"
        assert data["language_count"] == 3
        assert data["last_updated"] is not None

    def test_get_summary_not_fetched(self, client, mock_repo):
        """Test getting summary when not fetched yet returns 404."""
        response = client.get(f"/api/languages/{mock_repo.id}/summary")
        assert response.status_code == 404


class TestFetchLanguages:
    """Test cases for POST /api/languages/{repo_id}/fetch."""

    def test_fetch_success(self, client, mock_repo):
        """Test fetching languages from GitHub."""
        mock_github_data = {
            "Python": 120000,
            "JavaScript": 45000,
            "CSS": 15000,
        }

        mock_service = AsyncMock()
        mock_service.get_languages = AsyncMock(return_value=mock_github_data)

        with patch("routers.languages.get_github_service", return_value=mock_service):
            response = client.post(f"/api/languages/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["repo_name"] == mock_repo.full_name
        assert len(data["languages"]) == 3
        assert data["total_bytes"] == 180000
        assert data["primary_language"] == "Python"

        # Verify percentages are calculated
        for lang in data["languages"]:
            assert lang["percentage"] > 0

    def test_fetch_repo_not_found(self, client):
        """Test fetching languages for nonexistent repo returns 404."""
        response = client.post("/api/languages/99999/fetch")
        assert response.status_code == 404

    def test_fetch_empty_languages(self, client, mock_repo):
        """Test fetching when GitHub returns empty languages (no code)."""
        mock_service = AsyncMock()
        mock_service.get_languages = AsyncMock(return_value={})

        with patch("routers.languages.get_github_service", return_value=mock_service):
            response = client.post(f"/api/languages/{mock_repo.id}/fetch")

        assert response.status_code == 200
        data = response.json()
        assert data["repo_id"] == mock_repo.id
        assert data["languages"] == []
        assert data["total_bytes"] == 0
        assert data["primary_language"] is None
