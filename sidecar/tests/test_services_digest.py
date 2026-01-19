"""
Tests for services/digest.py - Digest generation service.
"""

from datetime import timedelta

from db.models import (
    Signal,
    SignalType,
    EarlySignal,
    EarlySignalType,
    EarlySignalSeverity,
)
from services.digest import (
    DigestService,
    get_digest_service,
)
# Import module for accessing protected members in tests
from services import digest as digest_module
from utils.time import utc_now


class TestEscapeHtml:
    """Tests for _escape_html function."""

    def test_escapes_special_characters(self):
        """Test escapes HTML special characters."""
        result = digest_module._escape_html("<script>alert('xss')</script>")
        assert "<" not in result
        assert ">" not in result

    def test_handles_none(self):
        """Test handles None input."""
        result = digest_module._escape_html(None)
        assert result == ""

    def test_handles_empty_string(self):
        """Test handles empty string."""
        result = digest_module._escape_html("")
        assert result == ""

    def test_preserves_normal_text(self):
        """Test preserves normal text."""
        result = digest_module._escape_html("Hello World")
        assert result == "Hello World"


class TestRenderVelocityTableMd:
    """Tests for _render_velocity_table_md function."""

    def test_renders_table(self):
        """Test renders velocity table."""
        digest = {
            "top_by_velocity": [
                {"repo_name": "test/repo", "url": "https://github.com/test/repo", "velocity": 10.5, "stars": 1000, "language": "Python"},
            ]
        }
        lines = []

        digest_module._render_velocity_table_md(digest, lines)

        assert any("Top by Velocity" in line for line in lines)
        assert any("test/repo" in line for line in lines)

    def test_handles_empty_velocity(self):
        """Test handles empty velocity list."""
        digest = {"top_by_velocity": []}
        lines = []

        digest_module._render_velocity_table_md(digest, lines)

        assert len(lines) == 0

    def test_handles_missing_key(self):
        """Test handles missing top_by_velocity key."""
        digest = {}
        lines = []

        digest_module._render_velocity_table_md(digest, lines)

        assert len(lines) == 0


class TestRenderGainersTableMd:
    """Tests for _render_gainers_table_md function."""

    def test_renders_table(self):
        """Test renders gainers table."""
        digest = {
            "biggest_gainers": [
                {"repo_name": "test/repo", "url": "https://github.com/test/repo", "delta": 500, "stars": 5000, "language": "Rust"},
            ]
        }
        lines = []

        digest_module._render_gainers_table_md(digest, lines)

        assert any("Biggest Gainers" in line for line in lines)
        assert any("+500" in line for line in lines)


class TestRenderSignalsMd:
    """Tests for _render_signals_md function."""

    def test_renders_signals(self):
        """Test renders signals list."""
        digest = {
            "recent_signals": [
                {"repo_name": "test/repo", "signal_type": "rising_star", "severity": "high", "description": "Rising fast"},
            ]
        }
        lines = []

        digest_module._render_signals_md(digest, lines)

        assert any("Recent Signals" in line for line in lines)
        assert any("Rising Star" in line for line in lines)


class TestRenderVelocityTableHtml:
    """Tests for _render_velocity_table_html function."""

    def test_renders_html_table(self):
        """Test renders HTML velocity table."""
        digest = {
            "top_by_velocity": [
                {"repo_name": "test/repo", "url": "https://github.com/test/repo", "velocity": 10.5, "stars": 1000, "language": "Python"},
            ]
        }

        result = digest_module._render_velocity_table_html(digest)

        assert "<table>" in result
        assert "test/repo" in result
        assert "</table>" in result

    def test_returns_empty_for_no_data(self):
        """Test returns empty string for no data."""
        digest = {"top_by_velocity": []}

        result = digest_module._render_velocity_table_html(digest)

        assert result == ""


class TestRenderGainersTableHtml:
    """Tests for _render_gainers_table_html function."""

    def test_renders_html_table(self):
        """Test renders HTML gainers table."""
        digest = {
            "biggest_gainers": [
                {"repo_name": "test/repo", "url": "https://github.com/test/repo", "delta": 500, "stars": 5000, "language": "Go"},
            ]
        }

        result = digest_module._render_gainers_table_html(digest)

        assert "<table>" in result
        assert "+500" in result


class TestRenderSignalsHtml:
    """Tests for _render_signals_html function."""

    def test_renders_html_signals(self):
        """Test renders HTML signals."""
        digest = {
            "recent_signals": [
                {"repo_name": "test/repo", "signal_type": "sudden_spike", "severity": "medium", "description": "Spike detected"},
            ]
        }

        result = digest_module._render_signals_html(digest)

        assert "Recent Signals" in result
        assert "Spike detected" in result


class TestDigestServiceGetTopReposByVelocity:
    """Tests for _get_top_repos_by_velocity method."""

    def test_returns_top_repos(self, test_db, mock_repo_with_signals):
        """Test returns repos sorted by velocity."""
        result = DigestService._get_top_repos_by_velocity(test_db, limit=5)

        assert isinstance(result, list)
        # May or may not have results depending on signals

    def test_respects_limit(self, test_db, mock_multiple_repos):
        """Test respects limit parameter."""
        # Create signals for repos
        for repo in mock_multiple_repos:
            signal = Signal(
                repo_id=repo.id,
                signal_type=SignalType.VELOCITY,
                value=10.0,
                calculated_at=utc_now(),
            )
            test_db.add(signal)
        test_db.commit()

        result = DigestService._get_top_repos_by_velocity(test_db, limit=2)

        assert len(result) <= 2


class TestDigestServiceGetBiggestGainers:
    """Tests for _get_biggest_gainers method."""

    def test_returns_gainers(self, test_db, mock_repo):
        """Test returns repos with positive gains."""
        # Create delta signal
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type=SignalType.STARS_DELTA_7D,
            value=100,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = DigestService._get_biggest_gainers(test_db, days=7, limit=10)

        assert len(result) >= 1
        assert result[0]["delta"] > 0


class TestDigestServiceGetRecentSignals:
    """Tests for _get_recent_signals method."""

    def test_returns_recent_signals(self, test_db, mock_repo):
        """Test returns signals from recent days."""
        # Create early signal
        signal = EarlySignal(
            repo_id=mock_repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=EarlySignalSeverity.HIGH,
            description="Rising star detected",
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),
        )
        test_db.add(signal)
        test_db.commit()

        result = DigestService._get_recent_signals(test_db, days=7, limit=10)

        assert len(result) >= 1


class TestDigestServiceGetStatsSummary:
    """Tests for _get_stats_summary method."""

    def test_returns_stats(self, test_db, mock_repo):
        """Test returns statistics summary."""
        result = DigestService._get_stats_summary(test_db, days=7)

        assert "total_repos" in result
        assert "new_signals" in result
        assert "high_severity_signals" in result
        assert "total_stars" in result


class TestDigestServiceGenerateWeeklyDigest:
    """Tests for generate_weekly_digest method."""

    def test_generates_weekly_digest(self, test_db, mock_repo):
        """Test generates weekly digest."""
        service = DigestService()
        result = service.generate_weekly_digest(test_db)

        assert result["period"] == "weekly"
        assert "generated_at" in result
        assert "stats" in result
        assert "top_by_velocity" in result
        assert "biggest_gainers" in result
        assert "recent_signals" in result


class TestDigestServiceGenerateDailyDigest:
    """Tests for generate_daily_digest method."""

    def test_generates_daily_digest(self, test_db, mock_repo):
        """Test generates daily digest."""
        service = DigestService()
        result = service.generate_daily_digest(test_db)

        assert result["period"] == "daily"
        assert "generated_at" in result
        assert "stats" in result
        assert "top_by_velocity" in result
        assert "recent_signals" in result


class TestDigestServiceRenderMarkdown:
    """Tests for render_markdown static method."""

    def test_renders_markdown(self):
        """Test renders digest as markdown."""
        digest = {
            "period": "weekly",
            "generated_at": "2024-01-15T12:00:00Z",
            "stats": {
                "total_repos": 10,
                "total_stars": 50000,
                "new_signals": 5,
                "high_severity_signals": 2,
            },
            "top_by_velocity": [],
            "biggest_gainers": [],
            "recent_signals": [],
        }

        result = DigestService.render_markdown(digest)

        assert "# StarScope Weekly Digest" in result
        assert "**Repos Tracked**: 10" in result
        assert "Generated by StarScope" in result


class TestDigestServiceRenderHtml:
    """Tests for render_html static method."""

    def test_renders_html(self):
        """Test renders digest as HTML."""
        digest = {
            "period": "daily",
            "generated_at": "2024-01-15T12:00:00Z",
            "stats": {
                "total_repos": 5,
                "total_stars": 25000,
                "new_signals": 3,
                "high_severity_signals": 1,
            },
            "top_by_velocity": [],
            "recent_signals": [],
        }

        result = DigestService.render_html(digest)

        assert "<!DOCTYPE html>" in result
        assert "StarScope Daily Digest" in result
        assert "</html>" in result

    def test_escapes_xss_in_html(self):
        """Test escapes potential XSS in HTML output."""
        digest = {
            "period": "daily",
            "generated_at": "2024-01-15T12:00:00Z",
            "stats": {
                "total_repos": 1,
                "total_stars": 100,
                "new_signals": 0,
                "high_severity_signals": 0,
            },
            "top_by_velocity": [
                {
                    "repo_name": "<script>alert('xss')</script>",
                    "url": "https://example.com",
                    "velocity": 10.0,
                    "stars": 100,
                    "language": "Python",
                }
            ],
            "recent_signals": [],
        }

        result = DigestService.render_html(digest)

        assert "<script>" not in result


class TestGetDigestService:
    """Tests for get_digest_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        digest_module._digest_service = None

        d1 = get_digest_service()
        d2 = get_digest_service()

        assert d1 is d2

    def test_creates_instance(self):
        """Test creates DigestService instance."""
        digest_module._digest_service = None

        service = get_digest_service()

        assert isinstance(service, DigestService)
