"""
Digest service for generating periodic summary reports.
Produces daily and weekly digests in Markdown and HTML formats.
"""

import html
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from db.models import (
    Repo, RepoSnapshot, Signal, SignalType,
    EarlySignal, EarlySignalType, ContextSignal,
)
from utils.time import utc_now

logger = logging.getLogger(__name__)


def _escape_html(text: str | None) -> str:
    """Escape HTML special characters to prevent XSS."""
    if text is None:
        return ""
    return html.escape(str(text))


class DigestService:
    """Service for generating summary digests."""

    def _get_top_repos_by_velocity(
        self,
        db: Session,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get top repos by velocity using optimized JOIN query."""
        # Use JOIN to avoid N+1 queries
        signals = db.query(Signal).filter(
            Signal.signal_type == SignalType.VELOCITY
        ).order_by(Signal.value.desc()).limit(limit).all()

        if not signals:
            return []

        # Batch fetch repos and latest snapshots
        repo_ids = [s.repo_id for s in signals]
        repos = {r.id: r for r in db.query(Repo).filter(Repo.id.in_(repo_ids)).all()}

        # Get latest snapshot per repo in a single query
        latest_snapshots_subq = db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date")
        ).filter(
            RepoSnapshot.repo_id.in_(repo_ids)
        ).group_by(RepoSnapshot.repo_id).subquery()

        snapshots = {
            s.repo_id: s for s in db.query(RepoSnapshot).join(
                latest_snapshots_subq,
                (RepoSnapshot.repo_id == latest_snapshots_subq.c.repo_id) &
                (RepoSnapshot.snapshot_date == latest_snapshots_subq.c.max_date)
            ).all()
        }

        results = []
        for signal in signals:
            repo = repos.get(signal.repo_id)
            if repo:
                snapshot = snapshots.get(repo.id)
                results.append({
                    "repo_name": repo.full_name,
                    "url": repo.url,
                    "velocity": signal.value,
                    "stars": snapshot.stars if snapshot else None,
                    "language": repo.language,
                })

        return results

    def _get_biggest_gainers(
        self,
        db: Session,
        days: int = 7,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get repos with biggest star gains in period using optimized query."""
        signal_type = SignalType.STARS_DELTA_7D if days == 7 else SignalType.STARS_DELTA_30D

        signals = db.query(Signal).filter(
            Signal.signal_type == signal_type,
            Signal.value > 0
        ).order_by(Signal.value.desc()).limit(limit).all()

        if not signals:
            return []

        # Batch fetch repos and snapshots
        repo_ids = [s.repo_id for s in signals]
        repos = {r.id: r for r in db.query(Repo).filter(Repo.id.in_(repo_ids)).all()}

        latest_snapshots_subq = db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date")
        ).filter(
            RepoSnapshot.repo_id.in_(repo_ids)
        ).group_by(RepoSnapshot.repo_id).subquery()

        snapshots = {
            s.repo_id: s for s in db.query(RepoSnapshot).join(
                latest_snapshots_subq,
                (RepoSnapshot.repo_id == latest_snapshots_subq.c.repo_id) &
                (RepoSnapshot.snapshot_date == latest_snapshots_subq.c.max_date)
            ).all()
        }

        results = []
        for signal in signals:
            repo = repos.get(signal.repo_id)
            if repo:
                snapshot = snapshots.get(repo.id)
                results.append({
                    "repo_name": repo.full_name,
                    "url": repo.url,
                    "delta": int(signal.value),
                    "stars": snapshot.stars if snapshot else None,
                    "language": repo.language,
                })

        return results

    def _get_recent_signals(
        self,
        db: Session,
        days: int = 7,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get early signals from the past N days."""
        cutoff = utc_now() - timedelta(days=days)

        # Use joinedload to eagerly load repo relationship
        signals = db.query(EarlySignal).options(
            joinedload(EarlySignal.repo)
        ).filter(
            EarlySignal.detected_at >= cutoff
        ).order_by(
            EarlySignal.severity.desc(),
            EarlySignal.detected_at.desc()
        ).limit(limit).all()

        return [
            {
                "repo_name": s.repo.full_name if s.repo else "Unknown",
                "signal_type": s.signal_type,
                "severity": s.severity,
                "description": s.description,
                "detected_at": s.detected_at.isoformat() if s.detected_at else None,
            }
            for s in signals
        ]

    def _get_stats_summary(
        self,
        db: Session,
        days: int = 7
    ) -> Dict[str, Any]:
        """Get overall statistics."""
        total_repos = db.query(Repo).count()

        cutoff = utc_now() - timedelta(days=days)
        new_signals = db.query(EarlySignal).filter(
            EarlySignal.detected_at >= cutoff
        ).count()

        high_severity = db.query(EarlySignal).filter(
            EarlySignal.detected_at >= cutoff,
            EarlySignal.severity == "high"
        ).count()

        # Total stars across all repos
        latest_snapshots = db.query(
            RepoSnapshot.repo_id,
            func.max(RepoSnapshot.snapshot_date).label("max_date")
        ).group_by(RepoSnapshot.repo_id).subquery()

        total_stars = db.query(func.sum(RepoSnapshot.stars)).join(
            latest_snapshots,
            (RepoSnapshot.repo_id == latest_snapshots.c.repo_id) &
            (RepoSnapshot.snapshot_date == latest_snapshots.c.max_date)
        ).scalar() or 0

        return {
            "total_repos": total_repos,
            "new_signals": new_signals,
            "high_severity_signals": high_severity,
            "total_stars": int(total_stars),
        }

    def generate_weekly_digest(self, db: Session) -> Dict[str, Any]:
        """Generate a weekly digest with all data."""
        stats = self._get_stats_summary(db, days=7)
        top_velocity = self._get_top_repos_by_velocity(db, limit=10)
        biggest_gainers = self._get_biggest_gainers(db, days=7, limit=10)
        recent_signals = self._get_recent_signals(db, days=7, limit=20)

        return {
            "period": "weekly",
            "generated_at": utc_now().isoformat(),
            "stats": stats,
            "top_by_velocity": top_velocity,
            "biggest_gainers": biggest_gainers,
            "recent_signals": recent_signals,
        }

    def generate_daily_digest(self, db: Session) -> Dict[str, Any]:
        """Generate a daily digest with key highlights."""
        stats = self._get_stats_summary(db, days=1)
        top_velocity = self._get_top_repos_by_velocity(db, limit=5)
        recent_signals = self._get_recent_signals(db, days=1, limit=10)

        return {
            "period": "daily",
            "generated_at": utc_now().isoformat(),
            "stats": stats,
            "top_by_velocity": top_velocity,
            "recent_signals": recent_signals,
        }

    def render_markdown(self, digest: Dict[str, Any]) -> str:
        """Render digest as Markdown."""
        period = digest["period"].title()
        generated = digest["generated_at"][:10]
        stats = digest["stats"]

        lines = [
            f"# StarScope {period} Digest",
            f"",
            f"*Generated: {generated}*",
            f"",
            f"## Summary",
            f"",
            f"- **Repos Tracked**: {stats['total_repos']:,}",
            f"- **Total Stars**: {stats['total_stars']:,}",
            f"- **New Signals**: {stats['new_signals']}",
            f"- **High Severity**: {stats['high_severity_signals']}",
            f"",
        ]

        # Top by velocity
        if digest.get("top_by_velocity"):
            lines.append("## Top by Velocity")
            lines.append("")
            lines.append("| Rank | Repository | Velocity | Stars | Language |")
            lines.append("|------|------------|----------|-------|----------|")
            for i, repo in enumerate(digest["top_by_velocity"], 1):
                stars = f"{repo['stars']:,}" if repo['stars'] else "N/A"
                velocity = f"{repo['velocity']:.1f}/day"
                lang = repo['language'] or "-"
                lines.append(f"| {i} | [{repo['repo_name']}]({repo['url']}) | {velocity} | {stars} | {lang} |")
            lines.append("")

        # Biggest gainers (weekly only)
        if digest.get("biggest_gainers"):
            lines.append("## Biggest Gainers (7 days)")
            lines.append("")
            lines.append("| Rank | Repository | +Stars | Total | Language |")
            lines.append("|------|------------|--------|-------|----------|")
            for i, repo in enumerate(digest["biggest_gainers"], 1):
                stars = f"{repo['stars']:,}" if repo['stars'] else "N/A"
                delta = f"+{repo['delta']:,}"
                lang = repo['language'] or "-"
                lines.append(f"| {i} | [{repo['repo_name']}]({repo['url']}) | {delta} | {stars} | {lang} |")
            lines.append("")

        # Recent signals
        if digest.get("recent_signals"):
            lines.append("## Recent Signals")
            lines.append("")
            for signal in digest["recent_signals"]:
                severity_emoji = {"high": "🔴", "medium": "🟡", "low": "⚪"}.get(signal['severity'], "⚪")
                signal_type = signal['signal_type'].replace('_', ' ').title()
                lines.append(f"- {severity_emoji} **{signal['repo_name']}**: {signal_type}")
                lines.append(f"  - {signal['description']}")
            lines.append("")

        lines.append("---")
        lines.append("*Generated by StarScope*")

        return "\n".join(lines)

    def render_html(self, digest: Dict[str, Any]) -> str:
        """Render digest as HTML."""
        period = digest["period"].title()
        generated = digest["generated_at"][:10]
        stats = digest["stats"]

        html_out = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>StarScope {period} Digest</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #1f2937; }}
        h1 {{ color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }}
        h2 {{ color: #374151; margin-top: 30px; }}
        .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 20px 0; }}
        .stat-card {{ background: #f3f4f6; padding: 16px; border-radius: 8px; text-align: center; }}
        .stat-value {{ font-size: 24px; font-weight: bold; color: #2563eb; }}
        .stat-label {{ font-size: 12px; color: #6b7280; margin-top: 4px; }}
        table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }}
        th {{ background: #f9fafb; font-weight: 600; color: #374151; }}
        a {{ color: #2563eb; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
        .signal {{ padding: 12px; margin: 8px 0; background: #f9fafb; border-radius: 6px; border-left: 4px solid #6b7280; }}
        .signal.high {{ border-left-color: #dc2626; }}
        .signal.medium {{ border-left-color: #ca8a04; }}
        .signal-type {{ font-weight: 600; color: #374151; }}
        .signal-desc {{ color: #6b7280; font-size: 14px; margin-top: 4px; }}
        .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }}
    </style>
</head>
<body>
    <h1>StarScope {period} Digest</h1>
    <p><em>Generated: {generated}</em></p>

    <h2>Summary</h2>
    <div class="stats">
        <div class="stat-card">
            <div class="stat-value">{stats['total_repos']:,}</div>
            <div class="stat-label">Repos Tracked</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{stats['total_stars']:,}</div>
            <div class="stat-label">Total Stars</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{stats['new_signals']}</div>
            <div class="stat-label">New Signals</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{stats['high_severity_signals']}</div>
            <div class="stat-label">High Severity</div>
        </div>
    </div>
"""

        # Top by velocity
        if digest.get("top_by_velocity"):
            html_out += """
    <h2>Top by Velocity</h2>
    <table>
        <thead>
            <tr><th>Rank</th><th>Repository</th><th>Velocity</th><th>Stars</th><th>Language</th></tr>
        </thead>
        <tbody>
"""
            for i, repo in enumerate(digest["top_by_velocity"], 1):
                stars = f"{repo['stars']:,}" if repo['stars'] else "N/A"
                velocity = f"{repo['velocity']:.1f}/day"
                lang = _escape_html(repo['language']) or "-"
                repo_name = _escape_html(repo["repo_name"])
                repo_url = _escape_html(repo["url"])
                html_out += f'            <tr><td>{i}</td><td><a href="{repo_url}">{repo_name}</a></td><td>{velocity}</td><td>{stars}</td><td>{lang}</td></tr>\n'
            html_out += """        </tbody>
    </table>
"""

        # Biggest gainers
        if digest.get("biggest_gainers"):
            html_out += """
    <h2>Biggest Gainers (7 days)</h2>
    <table>
        <thead>
            <tr><th>Rank</th><th>Repository</th><th>+Stars</th><th>Total</th><th>Language</th></tr>
        </thead>
        <tbody>
"""
            for i, repo in enumerate(digest["biggest_gainers"], 1):
                stars = f"{repo['stars']:,}" if repo['stars'] else "N/A"
                delta = f"+{repo['delta']:,}"
                lang = _escape_html(repo['language']) or "-"
                repo_name = _escape_html(repo["repo_name"])
                repo_url = _escape_html(repo["url"])
                html_out += f'            <tr><td>{i}</td><td><a href="{repo_url}">{repo_name}</a></td><td>{delta}</td><td>{stars}</td><td>{lang}</td></tr>\n'
            html_out += """        </tbody>
    </table>
"""

        # Recent signals
        if digest.get("recent_signals"):
            html_out += """
    <h2>Recent Signals</h2>
"""
            for signal in digest["recent_signals"]:
                severity = _escape_html(signal['severity'])
                signal_type = signal['signal_type'].replace('_', ' ').title()
                repo_name = _escape_html(signal['repo_name'])
                description = _escape_html(signal['description'])
                html_out += f'''    <div class="signal {severity}">
        <div class="signal-type">{repo_name}: {signal_type}</div>
        <div class="signal-desc">{description}</div>
    </div>
'''

        html_out += """
    <div class="footer">
        Generated by StarScope
    </div>
</body>
</html>"""

        return html_out


# Module-level singleton
_digest_service: Optional[DigestService] = None


def get_digest_service() -> DigestService:
    """Get the digest service singleton."""
    global _digest_service
    if _digest_service is None:
        _digest_service = DigestService()
        logger.info("Digest service initialized")
    return _digest_service
