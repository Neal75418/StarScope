"""
Digest service for generating periodic summary reports.
Produces daily and weekly digests in Markdown and HTML formats.
"""

import html
import logging
from datetime import timedelta
from typing import List, Dict, Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from db.models import (
    Repo, RepoSnapshot, Signal, SignalType,
    EarlySignal, )
from utils.time import utc_now

logger = logging.getLogger(__name__)


def _escape_html(text: Optional[str]) -> str:
    """Escape HTML special characters to prevent XSS."""
    if text is None:
        return ""
    return html.escape(str(text))


def _batch_load_repos_and_snapshots(
    repo_ids: List[int],
    db: Session
) -> tuple[Dict[int, "Repo"], Dict[int, "RepoSnapshot"]]:
    """
    Batch load repos and their latest snapshots.
    Returns: (repos_dict, snapshots_dict)
    """
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

    return repos, snapshots


def _render_velocity_table_md(digest: Dict[str, Any], lines: List[str]) -> None:
    """Render velocity table in Markdown format."""
    if not digest.get("top_by_velocity"):
        return
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


def _render_gainers_table_md(digest: Dict[str, Any], lines: List[str]) -> None:
    """Render biggest gainers table in Markdown format."""
    if not digest.get("biggest_gainers"):
        return
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


def _render_signals_md(digest: Dict[str, Any], lines: List[str]) -> None:
    """Render recent signals in Markdown format."""
    if not digest.get("recent_signals"):
        return
    lines.append("## Recent Signals")
    lines.append("")
    for signal in digest["recent_signals"]:
        severity_emoji = {"high": "🔴", "medium": "🟡", "low": "⚪"}.get(signal['severity'], "⚪")
        signal_type = signal['signal_type'].replace('_', ' ').title()
        lines.append(f"- {severity_emoji} **{signal['repo_name']}**: {signal_type}")
        lines.append(f"  - {signal['description']}")
    lines.append("")


def _render_velocity_table_html(digest: Dict[str, Any]) -> str:
    """Render velocity table in HTML format."""
    if not digest.get("top_by_velocity"):
        return ""
    html_out = """
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
    return html_out


def _render_gainers_table_html(digest: Dict[str, Any]) -> str:
    """Render biggest gainers table in HTML format."""
    if not digest.get("biggest_gainers"):
        return ""
    html_out = """
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
    return html_out


def _render_signals_html(digest: Dict[str, Any]) -> str:
    """Render recent signals in HTML format."""
    if not digest.get("recent_signals"):
        return ""
    html_out = """
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
    return html_out


class DigestService:
    """Service for generating summary digests."""

    @staticmethod
    def _get_top_repos_by_velocity(
        db: Session,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get top repos by velocity using optimized JOIN query."""
        signals = db.query(Signal).filter(
            Signal.signal_type == SignalType.VELOCITY
        ).order_by(Signal.value.desc()).limit(limit).all()

        if not signals:
            return []

        repo_ids = [int(s.repo_id) for s in signals]
        repos, snapshots = _batch_load_repos_and_snapshots(repo_ids, db)

        results = []
        for signal in signals:
            repo = repos.get(int(signal.repo_id))
            if repo:
                snapshot = snapshots.get(int(repo.id))
                results.append({
                    "repo_name": repo.full_name,
                    "url": repo.url,
                    "velocity": float(signal.value),
                    "stars": snapshot.stars if snapshot else None,
                    "language": repo.language,
                })

        return results

    @staticmethod
    def _get_biggest_gainers(
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

        repo_ids = [int(s.repo_id) for s in signals]
        repos, snapshots = _batch_load_repos_and_snapshots(repo_ids, db)

        results = []
        for signal in signals:
            repo = repos.get(int(signal.repo_id))
            if repo:
                snapshot = snapshots.get(int(repo.id))
                results.append({
                    "repo_name": repo.full_name,
                    "url": repo.url,
                    "delta": int(signal.value),
                    "stars": snapshot.stars if snapshot else None,
                    "language": repo.language,
                })

        return results

    @staticmethod
    def _get_recent_signals(
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

    @staticmethod
    def _get_stats_summary(
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

    @staticmethod
    def render_markdown(digest: Dict[str, Any]) -> str:
        """Render digest as Markdown."""
        period = digest["period"].title()
        generated = digest["generated_at"][:10]
        stats = digest["stats"]

        lines = [
            f"# StarScope {period} Digest",
            "",
            f"*Generated: {generated}*",
            "",
            "## Summary",
            "",
            f"- **Repos Tracked**: {stats['total_repos']:,}",
            f"- **Total Stars**: {stats['total_stars']:,}",
            f"- **New Signals**: {stats['new_signals']}",
            f"- **High Severity**: {stats['high_severity_signals']}",
            "",
        ]

        _render_velocity_table_md(digest, lines)
        _render_gainers_table_md(digest, lines)
        _render_signals_md(digest, lines)

        lines.append("---")
        lines.append("*Generated by StarScope*")

        return "\n".join(lines)

    @staticmethod
    def render_html(digest: Dict[str, Any]) -> str:
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

        html_out += _render_velocity_table_html(digest)
        html_out += _render_gainers_table_html(digest)
        html_out += _render_signals_html(digest)

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
