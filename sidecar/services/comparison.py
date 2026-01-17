"""
Comparison service for generating comparison reports between repositories.
Provides data for comparing stars, velocity, health scores across repos in a group.
"""

import logging
from datetime import date, timedelta
from typing import List, Optional, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models import ComparisonGroup, ComparisonMember, Repo, RepoSnapshot, HealthScore, Signal, SignalType
from utils.time import utc_now

logger = logging.getLogger(__name__)


class ComparisonService:
    """Service for generating comparison data."""

    def get_comparison_summary(self, group_id: int, db: Session) -> Optional[Dict[str, Any]]:
        """
        Get summary comparison data for a group.
        Returns current stats for all members.
        """
        group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
        if not group:
            return None

        members = db.query(ComparisonMember).filter(
            ComparisonMember.group_id == group_id
        ).order_by(ComparisonMember.sort_order).all()

        if not members:
            return {
                "group_id": group_id,
                "group_name": group.name,
                "description": group.description,
                "members": [],
                "summary": {},
            }

        member_data = []
        for member in members:
            repo = member.repo

            # Get latest snapshot
            latest_snapshot = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo.id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()

            # Get signals
            signals = {}
            for signal in db.query(Signal).filter(Signal.repo_id == repo.id).all():
                signals[signal.signal_type] = signal.value

            # Get health score
            health = db.query(HealthScore).filter(HealthScore.repo_id == repo.id).first()

            member_data.append({
                "repo_id": repo.id,
                "full_name": repo.full_name,
                "language": repo.language,
                "description": repo.description,
                "url": repo.url,
                "stars": latest_snapshot.stars if latest_snapshot else None,
                "forks": latest_snapshot.forks if latest_snapshot else None,
                "stars_delta_7d": signals.get(SignalType.STARS_DELTA_7D),
                "stars_delta_30d": signals.get(SignalType.STARS_DELTA_30D),
                "velocity": signals.get(SignalType.VELOCITY),
                "acceleration": signals.get(SignalType.ACCELERATION),
                "trend": signals.get(SignalType.TREND),
                "health_score": health.overall_score if health else None,
                "health_grade": health.grade if health else None,
            })

        # Calculate summary statistics
        stars_list = [m["stars"] for m in member_data if m["stars"] is not None]
        velocity_list = [m["velocity"] for m in member_data if m["velocity"] is not None]
        health_list = [m["health_score"] for m in member_data if m["health_score"] is not None]

        summary = {
            "total_members": len(member_data),
            "leader_by_stars": max(member_data, key=lambda x: x["stars"] or 0)["full_name"] if stars_list else None,
            "leader_by_velocity": max(member_data, key=lambda x: x["velocity"] or 0)["full_name"] if velocity_list else None,
            "leader_by_health": max(member_data, key=lambda x: x["health_score"] or 0)["full_name"] if health_list else None,
            "total_stars": sum(stars_list) if stars_list else 0,
            "avg_velocity": sum(velocity_list) / len(velocity_list) if velocity_list else 0,
            "avg_health": sum(health_list) / len(health_list) if health_list else 0,
        }

        return {
            "group_id": group_id,
            "group_name": group.name,
            "description": group.description,
            "members": member_data,
            "summary": summary,
        }

    def get_comparison_chart_data(
        self,
        group_id: int,
        db: Session,
        time_range: str = "30d"
    ) -> Optional[Dict[str, Any]]:
        """
        Get chart data for comparing repos over time.
        Returns time series data for stars.
        """
        group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
        if not group:
            return None

        members = db.query(ComparisonMember).filter(
            ComparisonMember.group_id == group_id
        ).order_by(ComparisonMember.sort_order).all()

        if not members:
            return {
                "group_id": group_id,
                "group_name": group.name,
                "time_range": time_range,
                "series": [],
                "dates": [],
            }

        # Calculate date range
        if time_range == "7d":
            days = 7
        elif time_range == "90d":
            days = 90
        else:
            days = 30

        end_date = date.today()
        start_date = end_date - timedelta(days=days)

        # Get all dates in range
        dates = []
        current = start_date
        while current <= end_date:
            dates.append(current.isoformat())
            current += timedelta(days=1)

        # Get data for each repo
        series = []
        for member in members:
            repo = member.repo

            # Get snapshots in range
            snapshots = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == repo.id,
                RepoSnapshot.snapshot_date >= start_date,
                RepoSnapshot.snapshot_date <= end_date
            ).order_by(RepoSnapshot.snapshot_date).all()

            # Build data points
            snapshot_map = {s.snapshot_date.isoformat(): s.stars for s in snapshots}

            data_points = []
            for d in dates:
                data_points.append(snapshot_map.get(d))

            series.append({
                "repo_id": repo.id,
                "full_name": repo.full_name,
                "language": repo.language,
                "data": data_points,
            })

        return {
            "group_id": group_id,
            "group_name": group.name,
            "time_range": time_range,
            "dates": dates,
            "series": series,
        }

    def get_velocity_comparison(self, group_id: int, db: Session) -> Optional[Dict[str, Any]]:
        """
        Get velocity comparison data for bar charts.
        """
        group = db.query(ComparisonGroup).filter(ComparisonGroup.id == group_id).first()
        if not group:
            return None

        members = db.query(ComparisonMember).filter(
            ComparisonMember.group_id == group_id
        ).order_by(ComparisonMember.sort_order).all()

        data = []
        for member in members:
            repo = member.repo

            # Get velocity signal
            velocity_signal = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.VELOCITY
            ).first()

            # Get delta signals
            delta_7d = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.STARS_DELTA_7D
            ).first()

            delta_30d = db.query(Signal).filter(
                Signal.repo_id == repo.id,
                Signal.signal_type == SignalType.STARS_DELTA_30D
            ).first()

            data.append({
                "repo_id": repo.id,
                "full_name": repo.full_name,
                "velocity": velocity_signal.value if velocity_signal else 0,
                "delta_7d": delta_7d.value if delta_7d else 0,
                "delta_30d": delta_30d.value if delta_30d else 0,
            })

        # Sort by velocity descending
        data.sort(key=lambda x: x["velocity"], reverse=True)

        return {
            "group_id": group_id,
            "group_name": group.name,
            "data": data,
        }


# Module-level singleton
_comparison_service: Optional[ComparisonService] = None


def get_comparison_service() -> ComparisonService:
    """Get the default comparison service instance."""
    global _comparison_service
    if _comparison_service is None:
        _comparison_service = ComparisonService()
        logger.info("Comparison service initialized")
    return _comparison_service
