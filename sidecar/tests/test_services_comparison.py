"""
Tests for services/comparison.py - Comparison service for repository analysis.
"""

import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from services.comparison import (
    ComparisonService,
    get_comparison_service,
    _build_member_data,
    _calculate_summary_stats,
)
from db.models import (
    ComparisonGroup,
    ComparisonMember,
    RepoSnapshot,
    HealthScore,
    Signal,
    SignalType,
    WatchedRepo,
)


class TestBuildMemberData:
    """Tests for _build_member_data helper function."""

    def test_builds_complete_data(self, test_db, mock_repo):
        """Test builds complete member data with all fields."""
        # Create snapshot
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=date.today(),
            stars=1000,
            forks=100,
        )
        test_db.add(snapshot)

        # Create signals
        signals = [
            Signal(repo_id=mock_repo.id, signal_type=SignalType.VELOCITY, value=5.5),
            Signal(repo_id=mock_repo.id, signal_type=SignalType.STARS_DELTA_7D, value=50),
            Signal(repo_id=mock_repo.id, signal_type=SignalType.STARS_DELTA_30D, value=200),
        ]
        test_db.add_all(signals)

        # Create health score
        health = HealthScore(
            repo_id=mock_repo.id,
            overall_score=85.0,
            grade="A",
        )
        test_db.add(health)
        test_db.commit()

        # Create member mock
        member = MagicMock()
        member.repo = mock_repo

        result = _build_member_data(member, test_db)

        assert result["repo_id"] == mock_repo.id
        assert result["full_name"] == mock_repo.full_name
        assert result["stars"] == 1000
        assert result["forks"] == 100
        assert result["velocity"] == 5.5
        assert result["health_score"] == 85.0
        assert result["health_grade"] == "A"

    def test_handles_missing_data(self, test_db, mock_repo):
        """Test handles missing snapshot and signals gracefully."""
        member = MagicMock()
        member.repo = mock_repo

        result = _build_member_data(member, test_db)

        assert result["repo_id"] == mock_repo.id
        assert result["stars"] is None
        assert result["velocity"] is None
        assert result["health_score"] is None


class TestCalculateSummaryStats:
    """Tests for _calculate_summary_stats helper function."""

    def test_calculates_stats_correctly(self):
        """Test calculates summary statistics correctly."""
        member_data = [
            {"full_name": "repo1", "stars": 1000, "velocity": 5.0, "health_score": 80.0},
            {"full_name": "repo2", "stars": 2000, "velocity": 10.0, "health_score": 90.0},
            {"full_name": "repo3", "stars": 500, "velocity": 2.5, "health_score": 70.0},
        ]

        result = _calculate_summary_stats(member_data)

        assert result["total_members"] == 3
        assert result["leader_by_stars"] == "repo2"
        assert result["leader_by_velocity"] == "repo2"
        assert result["leader_by_health"] == "repo2"
        assert result["total_stars"] == 3500
        assert result["avg_velocity"] == pytest.approx(5.833, rel=0.01)
        assert result["avg_health"] == 80.0

    def test_handles_none_values(self):
        """Test handles None values in member data."""
        member_data = [
            {"full_name": "repo1", "stars": None, "velocity": None, "health_score": None},
            {"full_name": "repo2", "stars": 1000, "velocity": 5.0, "health_score": 80.0},
        ]

        result = _calculate_summary_stats(member_data)

        assert result["total_members"] == 2
        assert result["leader_by_stars"] == "repo2"
        assert result["total_stars"] == 1000

    def test_handles_empty_list(self):
        """Test handles empty member data list."""
        result = _calculate_summary_stats([])

        assert result["total_members"] == 0
        assert result["leader_by_stars"] is None
        assert result["total_stars"] == 0
        assert result["avg_velocity"] == 0


class TestComparisonServiceGetSummary:
    """Tests for ComparisonService.get_comparison_summary."""

    def test_returns_none_for_nonexistent_group(self, test_db):
        """Test returns None when group doesn't exist."""
        result = ComparisonService.get_comparison_summary(99999, test_db)
        assert result is None

    def test_returns_empty_members_for_empty_group(self, test_db):
        """Test returns empty members list for group with no members."""
        group = ComparisonGroup(name="Empty Group", description="No members")
        test_db.add(group)
        test_db.commit()

        result = ComparisonService.get_comparison_summary(group.id, test_db)

        assert result is not None
        assert result["group_name"] == "Empty Group"
        assert result["members"] == []
        assert result["summary"] == {}

    def test_returns_full_summary(self, test_db, mock_comparison_group):
        """Test returns full comparison summary."""
        result = ComparisonService.get_comparison_summary(mock_comparison_group.id, test_db)

        assert result is not None
        assert result["group_id"] == mock_comparison_group.id
        assert result["group_name"] == mock_comparison_group.name
        assert "members" in result
        assert "summary" in result


class TestComparisonServiceGetChartData:
    """Tests for ComparisonService.get_comparison_chart_data."""

    def test_returns_none_for_nonexistent_group(self, test_db):
        """Test returns None when group doesn't exist."""
        result = ComparisonService.get_comparison_chart_data(99999, test_db)
        assert result is None

    def test_returns_empty_series_for_empty_group(self, test_db):
        """Test returns empty series for group with no members."""
        group = ComparisonGroup(name="Empty Group")
        test_db.add(group)
        test_db.commit()

        result = ComparisonService.get_comparison_chart_data(group.id, test_db)

        assert result is not None
        assert result["series"] == []
        assert result["dates"] == []

    def test_uses_correct_time_range_7d(self, test_db, mock_comparison_group):
        """Test uses 7-day time range when specified."""
        result = ComparisonService.get_comparison_chart_data(
            mock_comparison_group.id, test_db, time_range="7d"
        )

        assert result is not None
        assert result["time_range"] == "7d"
        assert len(result["dates"]) == 8  # 7 days + today

    def test_uses_correct_time_range_30d(self, test_db, mock_comparison_group):
        """Test uses 30-day time range by default."""
        result = ComparisonService.get_comparison_chart_data(
            mock_comparison_group.id, test_db
        )

        assert result is not None
        assert result["time_range"] == "30d"
        assert len(result["dates"]) == 31  # 30 days + today

    def test_uses_correct_time_range_90d(self, test_db, mock_comparison_group):
        """Test uses 90-day time range when specified."""
        result = ComparisonService.get_comparison_chart_data(
            mock_comparison_group.id, test_db, time_range="90d"
        )

        assert result is not None
        assert result["time_range"] == "90d"
        assert len(result["dates"]) == 91  # 90 days + today


class TestComparisonServiceGetVelocityComparison:
    """Tests for ComparisonService.get_velocity_comparison."""

    def test_returns_none_for_nonexistent_group(self, test_db):
        """Test returns None when group doesn't exist."""
        result = ComparisonService.get_velocity_comparison(99999, test_db)
        assert result is None

    def test_returns_velocity_data(self, test_db, mock_comparison_group):
        """Test returns velocity comparison data."""
        result = ComparisonService.get_velocity_comparison(mock_comparison_group.id, test_db)

        assert result is not None
        assert result["group_id"] == mock_comparison_group.id
        assert "data" in result
        assert isinstance(result["data"], list)

    def test_sorts_by_velocity_descending(self, test_db):
        """Test data is sorted by velocity in descending order."""
        # Create group with repos that have different velocities
        group = ComparisonGroup(name="Velocity Test")
        test_db.add(group)
        test_db.commit()

        repos = []
        for i, velocity in enumerate([5.0, 15.0, 10.0]):
            repo = WatchedRepo(
                full_name=f"test/repo{i}",
                owner=f"test",
                name=f"repo{i}",
            )
            test_db.add(repo)
            test_db.commit()

            member = ComparisonMember(group_id=group.id, repo_id=repo.id, sort_order=i)
            test_db.add(member)

            signal = Signal(repo_id=repo.id, signal_type=SignalType.VELOCITY, value=velocity)
            test_db.add(signal)
            repos.append(repo)

        test_db.commit()

        result = ComparisonService.get_velocity_comparison(group.id, test_db)

        assert result["data"][0]["velocity"] == 15.0
        assert result["data"][1]["velocity"] == 10.0
        assert result["data"][2]["velocity"] == 5.0


class TestGetComparisonService:
    """Tests for get_comparison_service function."""

    def test_returns_singleton(self):
        """Test returns the same instance."""
        import services.comparison as comparison_module
        comparison_module._comparison_service = None

        s1 = get_comparison_service()
        s2 = get_comparison_service()

        assert s1 is s2

    def test_creates_instance(self):
        """Test creates ComparisonService instance."""
        import services.comparison as comparison_module
        comparison_module._comparison_service = None

        service = get_comparison_service()

        assert isinstance(service, ComparisonService)
