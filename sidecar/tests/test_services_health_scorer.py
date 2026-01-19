"""
Tests for services/health_scorer.py - Health score calculator.
"""

from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock

import pytest

from services.health_scorer import (
    HealthMetrics,
    HealthScoreResult,
    HealthScorer,
)
# Import module for accessing protected members in tests
from services import health_scorer as health_scorer_module


class TestParseIsoDatetime:
    """Tests for _parse_iso_datetime function."""

    def test_parse_valid_datetime_with_z(self):
        """Test parsing ISO datetime with Z suffix."""
        result = health_scorer_module._parse_iso_datetime("2024-01-15T10:30:00Z")
        assert result is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_valid_datetime_with_offset(self):
        """Test parsing ISO datetime with offset."""
        result = health_scorer_module._parse_iso_datetime("2024-01-15T10:30:00+00:00")
        assert result is not None

    def test_parse_empty_string(self):
        """Test parsing empty string returns None."""
        assert health_scorer_module._parse_iso_datetime("") is None

    def test_parse_invalid_format(self):
        """Test parsing invalid format returns None."""
        assert health_scorer_module._parse_iso_datetime("not-a-date") is None


class TestCalculateIssueResponseTimes:
    """Tests for _calculate_issue_response_times function."""

    def test_closed_issues_with_response(self):
        """Test calculating response times for closed issues."""
        issues = [
            {
                "state": "closed",
                "created_at": "2024-01-01T00:00:00Z",
                "closed_at": "2024-01-01T12:00:00Z",
            },
            {
                "state": "closed",
                "created_at": "2024-01-02T00:00:00Z",
                "closed_at": "2024-01-03T00:00:00Z",
            },
        ]
        result = health_scorer_module._calculate_issue_response_times(issues)
        assert len(result) == 2
        assert result[0] == pytest.approx(12.0)  # 12 hours
        assert result[1] == pytest.approx(24.0)  # 24 hours

    def test_open_issues_ignored(self):
        """Test that open issues are ignored."""
        issues = [
            {"state": "open", "created_at": "2024-01-01T00:00:00Z"},
        ]
        result = health_scorer_module._calculate_issue_response_times(issues)
        assert len(result) == 0

    def test_empty_issues(self):
        """Test with empty issues list."""
        assert health_scorer_module._calculate_issue_response_times([]) == []


class TestProcessIssuesData:
    """Tests for _process_issues_data function."""

    def test_process_valid_issues(self):
        """Test processing valid issues data."""
        issues_data = [
            {"state": "open"},
            {"state": "closed", "created_at": "2024-01-01T00:00:00Z", "closed_at": "2024-01-01T01:00:00Z"},
            {"pull_request": {}, "state": "open"},  # Should be ignored (it's a PR)
        ]
        metrics = HealthMetrics()
        health_scorer_module._process_issues_data(issues_data, metrics)

        assert metrics.open_issues_count == 1
        assert metrics.closed_issues_count == 1

    def test_process_non_list(self):
        """Test processing non-list returns early."""
        metrics = HealthMetrics()
        health_scorer_module._process_issues_data(None, metrics)
        assert metrics.open_issues_count == 0


class TestProcessPullsData:
    """Tests for _process_pulls_data function."""

    def test_process_valid_pulls(self):
        """Test processing valid pull requests data."""
        pulls_data = [
            {"state": "open"},
            {"state": "closed", "merged_at": "2024-01-01T00:00:00Z"},
            {"state": "closed", "merged_at": None},
        ]
        metrics = HealthMetrics()
        health_scorer_module._process_pulls_data(pulls_data, metrics)

        assert metrics.open_prs_count == 1
        assert metrics.merged_prs_count == 1
        assert metrics.closed_prs_count == 1


class TestProcessReleasesData:
    """Tests for _process_releases_data function."""

    def test_process_valid_releases(self):
        """Test processing valid releases data."""
        now = datetime.now(timezone.utc)
        releases_data = [
            {"draft": False, "published_at": (now - timedelta(days=10)).isoformat()},
            {"draft": False, "published_at": (now - timedelta(days=100)).isoformat()},
            {"draft": True, "published_at": now.isoformat()},  # Draft should be ignored
        ]
        metrics = HealthMetrics()
        health_scorer_module._process_releases_data(releases_data, metrics)

        assert metrics.days_since_last_release is not None
        assert metrics.days_since_last_release >= 10
        assert metrics.releases_last_year >= 2

    def test_process_empty_releases(self):
        """Test processing empty releases."""
        metrics = HealthMetrics()
        health_scorer_module._process_releases_data([], metrics)
        assert metrics.days_since_last_release is None


class TestProcessContributorsData:
    """Tests for _process_contributors_data function."""

    def test_process_valid_contributors(self):
        """Test processing valid contributors data."""
        contributors_data = [
            {"contributions": 100},
            {"contributions": 50},
            {"contributions": 25},
        ]
        metrics = HealthMetrics()
        health_scorer_module._process_contributors_data(contributors_data, metrics)

        assert metrics.contributor_count == 3
        # Top contributor has 100 out of 175 total
        assert round(metrics.top_contributor_percentage, 1) == pytest.approx(57.1)

    def test_process_empty_contributors(self):
        """Test processing empty contributors."""
        metrics = HealthMetrics()
        health_scorer_module._process_contributors_data([], metrics)
        assert metrics.contributor_count == 0


class TestProcessCommunityData:
    """Tests for _process_community_data function."""

    def test_process_valid_community(self):
        """Test processing valid community profile data."""
        community_data = {
            "files": {
                "readme": {"url": "..."},
                "contributing": {"url": "..."},
                "license": {"key": "mit"},
                "code_of_conduct": {"url": "..."},
            }
        }
        metrics = HealthMetrics()
        health_scorer_module._process_community_data(community_data, metrics)

        assert metrics.has_readme is True
        assert metrics.has_contributing is True
        assert metrics.has_license is True
        assert metrics.has_code_of_conduct is True

    def test_process_minimal_community(self):
        """Test processing minimal community profile."""
        community_data = {"files": {"readme": {"url": "..."}}}
        metrics = HealthMetrics()
        health_scorer_module._process_community_data(community_data, metrics)

        assert metrics.has_readme is True
        assert metrics.has_contributing is False


class TestScoreIssueResponse:
    """Tests for _score_issue_response function."""

    def test_excellent_response(self):
        """Test excellent response time (<24h)."""
        assert health_scorer_module._score_issue_response(12.0) == 100

    def test_good_response(self):
        """Test good response time (24-72h)."""
        assert health_scorer_module._score_issue_response(48.0) == 80

    def test_moderate_response(self):
        """Test moderate response time (72-168h)."""
        assert health_scorer_module._score_issue_response(100.0) == 60

    def test_slow_response(self):
        """Test slow response time (168-720h)."""
        assert health_scorer_module._score_issue_response(300.0) == 40

    def test_very_slow_response(self):
        """Test very slow response time (>720h)."""
        assert health_scorer_module._score_issue_response(1000.0) == 20

    def test_none_response(self):
        """Test None response time."""
        assert health_scorer_module._score_issue_response(None) is None


class TestScorePrMerge:
    """Tests for _score_pr_merge function."""

    def test_excellent_merge_rate(self):
        """Test excellent merge rate (90%+)."""
        assert health_scorer_module._score_pr_merge(95, 5) == 100

    def test_good_merge_rate(self):
        """Test good merge rate (70-90%)."""
        assert health_scorer_module._score_pr_merge(80, 20) == 80

    def test_moderate_merge_rate(self):
        """Test moderate merge rate (50-70%)."""
        assert health_scorer_module._score_pr_merge(60, 40) == 60

    def test_low_merge_rate(self):
        """Test low merge rate (30-50%)."""
        assert health_scorer_module._score_pr_merge(40, 60) == 40

    def test_very_low_merge_rate(self):
        """Test very low merge rate (<30%)."""
        assert health_scorer_module._score_pr_merge(20, 80) == 20

    def test_no_prs(self):
        """Test with no PRs."""
        assert health_scorer_module._score_pr_merge(0, 0) is None


class TestScoreReleaseCadence:
    """Tests for _score_release_cadence function."""

    def test_excellent_cadence(self):
        """Test excellent release cadence (<30 days)."""
        assert health_scorer_module._score_release_cadence(15) == 100

    def test_good_cadence(self):
        """Test good release cadence (30-90 days)."""
        assert health_scorer_module._score_release_cadence(60) == 80

    def test_moderate_cadence(self):
        """Test moderate release cadence (90-180 days)."""
        assert health_scorer_module._score_release_cadence(120) == 60

    def test_slow_cadence(self):
        """Test slow release cadence (180-365 days)."""
        assert health_scorer_module._score_release_cadence(250) == 40

    def test_very_slow_cadence(self):
        """Test very slow release cadence (>365 days)."""
        assert health_scorer_module._score_release_cadence(500) == 20

    def test_none_cadence(self):
        """Test None cadence."""
        assert health_scorer_module._score_release_cadence(None) is None


class TestScoreBusFactor:
    """Tests for _score_bus_factor function."""

    def test_excellent_bus_factor(self):
        """Test excellent bus factor (many contributors, low concentration)."""
        score = health_scorer_module._score_bus_factor(15, 20.0)
        assert score is not None
        assert score > 80

    def test_poor_bus_factor(self):
        """Test poor bus factor (few contributors, high concentration)."""
        score = health_scorer_module._score_bus_factor(2, 95.0)
        assert score is not None
        assert score < 50

    def test_no_contributors(self):
        """Test with no contributors."""
        assert health_scorer_module._score_bus_factor(0, 0.0) is None


class TestScoreDocumentation:
    """Tests for _score_documentation function."""

    def test_full_documentation(self):
        """Test with all documentation files."""
        metrics = HealthMetrics(
            has_readme=True,
            has_license=True,
            has_contributing=True,
            has_code_of_conduct=True,
        )
        assert health_scorer_module._score_documentation(metrics) == 100

    def test_partial_documentation(self):
        """Test with partial documentation."""
        metrics = HealthMetrics(has_readme=True, has_license=True)
        assert health_scorer_module._score_documentation(metrics) == 70

    def test_no_documentation(self):
        """Test with no documentation files."""
        metrics = HealthMetrics()
        assert health_scorer_module._score_documentation(metrics) is None


class TestScoreVelocity:
    """Tests for _score_velocity function."""

    def test_excellent_velocity(self):
        """Test excellent velocity (10+/day)."""
        assert health_scorer_module._score_velocity(15.0) == 100

    def test_good_velocity(self):
        """Test good velocity (5-10/day)."""
        assert health_scorer_module._score_velocity(7.0) == 80

    def test_moderate_velocity(self):
        """Test moderate velocity (1-5/day)."""
        assert health_scorer_module._score_velocity(3.0) == 60

    def test_low_velocity(self):
        """Test low velocity (0.1-1/day)."""
        assert health_scorer_module._score_velocity(0.5) == 40

    def test_very_low_velocity(self):
        """Test very low velocity (<0.1/day)."""
        assert health_scorer_module._score_velocity(0.05) == 20


class TestScoreToGrade:
    """Tests for _score_to_grade function."""

    def test_grades(self):
        """Test all grade conversions."""
        assert health_scorer_module._score_to_grade(97) == "A+"
        assert health_scorer_module._score_to_grade(92) == "A"
        assert health_scorer_module._score_to_grade(87) == "B+"
        assert health_scorer_module._score_to_grade(82) == "B"
        assert health_scorer_module._score_to_grade(77) == "C+"
        assert health_scorer_module._score_to_grade(72) == "C"
        assert health_scorer_module._score_to_grade(65) == "D"
        assert health_scorer_module._score_to_grade(55) == "F"


class TestHealthScorer:
    """Tests for HealthScorer class."""

    def test_calculate_scores(self):
        """Test calculating scores from metrics."""
        metrics = HealthMetrics(
            avg_issue_response_hours=48.0,
            merged_prs_count=80,
            closed_prs_count=20,
            days_since_last_release=45,
            contributor_count=10,
            top_contributor_percentage=40.0,
            has_readme=True,
            has_license=True,
            star_velocity=5.0,
        )

        result = HealthScorer.calculate_scores(metrics)

        assert isinstance(result, HealthScoreResult)
        assert result.overall_score > 0
        assert result.grade in ["A+", "A", "B+", "B", "C+", "C", "D", "F"]
        assert result.issue_response_score == 80
        assert result.pr_merge_score == 80
        assert result.velocity_score == 80

    def test_calculate_scores_minimal_data(self):
        """Test calculating scores with minimal data."""
        metrics = HealthMetrics(star_velocity=1.0)
        result = HealthScorer.calculate_scores(metrics)

        assert isinstance(result, HealthScoreResult)
        assert result.overall_score > 0

    @pytest.mark.asyncio
    async def test_fetch_metrics_mocked(self):
        """Test fetching metrics with mocked HTTP client."""
        scorer = HealthScorer(token="test-token")

        with patch.object(scorer, '_fetch_json', new_callable=AsyncMock) as mock_fetch:
            # Mock all API responses
            mock_fetch.return_value = {}

            metrics = await scorer.fetch_metrics("owner", "repo", star_velocity=2.0)

            assert isinstance(metrics, HealthMetrics)
            assert metrics.star_velocity == pytest.approx(2.0)
