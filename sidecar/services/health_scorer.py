"""
Project health score calculator.
Analyzes GitHub repository metrics to generate a health score.
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import httpx

from constants import GITHUB_API_TIMEOUT_SECONDS, GITHUB_TOKEN_ENV_VAR

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"

# Timezone constant for ISO datetime parsing
UTC_OFFSET_SUFFIX = "+00:00"

# Score weights (must sum to 1.0)
WEIGHTS = {
    "issue_response": 0.20,
    "pr_merge": 0.20,
    "release_cadence": 0.15,
    "bus_factor": 0.15,
    "documentation": 0.10,
    "dependency": 0.10,
    "velocity": 0.10,
}


@dataclass
class HealthMetrics:
    """Raw health metrics from GitHub."""
    # Issue metrics
    avg_issue_response_hours: Optional[float] = None
    open_issues_count: int = 0
    closed_issues_count: int = 0

    # PR metrics
    merged_prs_count: int = 0
    closed_prs_count: int = 0
    open_prs_count: int = 0

    # Release metrics
    days_since_last_release: Optional[int] = None
    releases_last_year: int = 0

    # Contributor metrics
    contributor_count: int = 0
    top_contributor_percentage: float = 0.0

    # Documentation
    has_readme: bool = False
    has_contributing: bool = False
    has_license: bool = False
    has_code_of_conduct: bool = False

    # Velocity (from existing signals)
    star_velocity: float = 0.0


@dataclass
class HealthScoreResult:
    """Calculated health scores."""
    overall_score: float
    grade: str

    # Individual scores (0-100)
    issue_response_score: Optional[float] = None
    pr_merge_score: Optional[float] = None
    release_cadence_score: Optional[float] = None
    bus_factor_score: Optional[float] = None
    documentation_score: Optional[float] = None
    dependency_score: Optional[float] = None
    velocity_score: Optional[float] = None

    # Raw metrics for transparency
    metrics: Optional[HealthMetrics] = None


def _parse_iso_datetime(date_str: str) -> Optional[datetime]:
    """Parse ISO datetime string with Z suffix to datetime."""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", UTC_OFFSET_SUFFIX))
    except (ValueError, TypeError):
        return None


def _calculate_issue_response_times(issues: list) -> list:
    """Calculate response times for closed issues."""
    response_times = []
    for issue in issues:
        if issue.get("state") != "closed":
            continue
        created = _parse_iso_datetime(issue.get("created_at", ""))
        closed = _parse_iso_datetime(issue.get("closed_at", ""))
        if created and closed:
            hours = (closed - created).total_seconds() / 3600
            if hours > 0:
                response_times.append(hours)
    return response_times


def _process_issues_data(issues_data: Any, metrics: HealthMetrics) -> None:
    """Process issues data into metrics."""
    if not isinstance(issues_data, list):
        return

    issues = [i for i in issues_data if "pull_request" not in i]
    metrics.open_issues_count = len([i for i in issues if i.get("state") == "open"])
    metrics.closed_issues_count = len([i for i in issues if i.get("state") == "closed"])

    response_times = _calculate_issue_response_times(issues)
    if response_times:
        metrics.avg_issue_response_hours = sum(response_times) / len(response_times)


def _process_pulls_data(pulls_data: Any, metrics: HealthMetrics) -> None:
    """Process pull requests data into metrics."""
    if not isinstance(pulls_data, list):
        return

    metrics.open_prs_count = len([p for p in pulls_data if p.get("state") == "open"])
    metrics.merged_prs_count = len([p for p in pulls_data if p.get("merged_at")])
    metrics.closed_prs_count = len([
        p for p in pulls_data
        if p.get("state") == "closed" and not p.get("merged_at")
    ])


def _process_releases_data(releases_data: Any, metrics: HealthMetrics) -> None:
    """Process releases data into metrics."""
    if not isinstance(releases_data, list) or not releases_data:
        return

    releases = [r for r in releases_data if not r.get("draft")]
    if not releases:
        return

    # Days since last release
    latest = releases[0]
    published = _parse_iso_datetime(latest.get("published_at", ""))
    if published:
        metrics.days_since_last_release = (datetime.now(timezone.utc) - published).days

    # Releases in last year
    one_year_ago = datetime.now(timezone.utc) - timedelta(days=365)
    for release in releases:
        published = _parse_iso_datetime(release.get("published_at", ""))
        if published and published > one_year_ago:
            metrics.releases_last_year += 1


def _process_contributors_data(contributors_data: Any, metrics: HealthMetrics) -> None:
    """Process contributors data into metrics."""
    if not isinstance(contributors_data, list):
        return

    metrics.contributor_count = len(contributors_data)
    if metrics.contributor_count == 0:
        return

    total_contributions = sum(c.get("contributions", 0) for c in contributors_data)
    if total_contributions > 0 and contributors_data:
        top_contributions = contributors_data[0].get("contributions", 0)
        metrics.top_contributor_percentage = (top_contributions / total_contributions) * 100


def _process_community_data(community_data: Any, metrics: HealthMetrics) -> None:
    """Process community profile data into metrics."""
    if not isinstance(community_data, dict):
        return

    files = community_data.get("files", {})
    metrics.has_readme = files.get("readme") is not None
    metrics.has_contributing = files.get("contributing") is not None
    metrics.has_code_of_conduct = files.get("code_of_conduct") is not None
    if files.get("license"):
        metrics.has_license = True


# Scoring helper functions
def _score_issue_response(hours: Optional[float]) -> Optional[float]:
    """Score issue response time. < 24h = 100, < 72h = 80, etc."""
    if hours is None:
        return None
    if hours < 24:
        return 100
    if hours < 72:
        return 80
    if hours < 168:
        return 60
    if hours < 720:
        return 40
    return 20


def _score_pr_merge(merged: int, closed: int) -> Optional[float]:
    """Score PR merge rate. 90%+ = 100, 70-90% = 80, etc."""
    total = merged + closed
    if total == 0:
        return None
    merge_rate = (merged / total) * 100
    if merge_rate >= 90:
        return 100
    if merge_rate >= 70:
        return 80
    if merge_rate >= 50:
        return 60
    if merge_rate >= 30:
        return 40
    return 20


def _score_release_cadence(days: Optional[int]) -> Optional[float]:
    """Score release cadence. < 30 days = 100, < 90 = 80, etc."""
    if days is None:
        return None
    if days < 30:
        return 100
    if days < 90:
        return 80
    if days < 180:
        return 60
    if days < 365:
        return 40
    return 20


def _score_bus_factor(contributor_count: int, top_percentage: float) -> Optional[float]:
    """Score bus factor based on contributor count and concentration."""
    if contributor_count == 0:
        return None

    contributor_score = min(100, contributor_count * 10)

    if top_percentage < 30:
        concentration_score = 100
    elif top_percentage < 50:
        concentration_score = 80
    elif top_percentage < 70:
        concentration_score = 60
    elif top_percentage < 90:
        concentration_score = 40
    else:
        concentration_score = 20

    return (contributor_score + concentration_score) / 2


def _score_documentation(metrics: HealthMetrics) -> Optional[float]:
    """Score documentation based on presence of key files."""
    doc_points = 0
    doc_items = 0

    if metrics.has_readme:
        doc_points += 40
        doc_items += 1
    if metrics.has_license:
        doc_points += 30
        doc_items += 1
    if metrics.has_contributing:
        doc_points += 20
        doc_items += 1
    if metrics.has_code_of_conduct:
        doc_points += 10
        doc_items += 1

    return doc_points if doc_items > 0 else None


def _score_velocity(star_velocity: float) -> float:
    """Score velocity. 10+/day = 100, 5+/day = 80, etc."""
    if star_velocity >= 10:
        return 100
    if star_velocity >= 5:
        return 80
    if star_velocity >= 1:
        return 60
    if star_velocity >= 0.1:
        return 40
    return 20


def _score_to_grade(score: float) -> str:
    """Convert numeric score to letter grade."""
    if score >= 95:
        return "A+"
    if score >= 90:
        return "A"
    if score >= 85:
        return "B+"
    if score >= 80:
        return "B"
    if score >= 75:
        return "C+"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


class HealthScorer:
    """Service for calculating project health scores."""

    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS):
        from services.github import build_github_headers
        self.token = token
        self.timeout = timeout
        self.headers = build_github_headers(token)

    async def _fetch_json(self, client: httpx.AsyncClient, url: str, params: Optional[Dict] = None) -> Any:
        """Fetch JSON from GitHub API with error handling."""
        from services.github import handle_github_response
        try:
            response = await client.get(url, params=params, headers=self.headers)
            return handle_github_response(response, raise_on_error=False, context=url)
        except httpx.TimeoutException:
            logger.warning(f"Timeout fetching {url}")
            return None
        except httpx.RequestError as e:
            logger.warning(f"Request error for {url}: {e}")
            return None

    async def fetch_metrics(self, owner: str, repo: str, star_velocity: float = 0.0) -> HealthMetrics:
        """Fetch all health-related metrics from GitHub."""
        metrics = HealthMetrics(star_velocity=star_velocity)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # Fetch all data in parallel
            tasks = {
                "repo": self._fetch_json(client, f"{GITHUB_API_BASE}/repos/{owner}/{repo}"),
                "issues": self._fetch_json(
                    client,
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/issues",
                    {"state": "all", "per_page": 100, "sort": "updated"}
                ),
                "pulls": self._fetch_json(
                    client,
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls",
                    {"state": "all", "per_page": 100, "sort": "updated"}
                ),
                "releases": self._fetch_json(
                    client,
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/releases",
                    {"per_page": 30}
                ),
                "contributors": self._fetch_json(
                    client,
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contributors",
                    {"per_page": 100}
                ),
                "community": self._fetch_json(
                    client,
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/community/profile"
                ),
            }

            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            data = dict(zip(tasks.keys(), results))

            # Process repo data (basic info)
            if isinstance(data["repo"], dict):
                metrics.has_license = data["repo"].get("license") is not None
                metrics.open_issues_count = data["repo"].get("open_issues_count", 0)

            # Process each data source using helper functions
            _process_issues_data(data["issues"], metrics)
            _process_pulls_data(data["pulls"], metrics)
            _process_releases_data(data["releases"], metrics)
            _process_contributors_data(data["contributors"], metrics)
            _process_community_data(data["community"], metrics)

        return metrics

    @staticmethod
    def calculate_scores(metrics: HealthMetrics) -> HealthScoreResult:
        """Calculate health scores from metrics."""
        # Calculate individual scores using helper functions
        scores: Dict[str, Optional[float]] = {
            "issue_response": _score_issue_response(metrics.avg_issue_response_hours),
            "pr_merge": _score_pr_merge(metrics.merged_prs_count, metrics.closed_prs_count),
            "release_cadence": _score_release_cadence(metrics.days_since_last_release),
            "bus_factor": _score_bus_factor(
                metrics.contributor_count, metrics.top_contributor_percentage
            ),
            "documentation": _score_documentation(metrics),
            "dependency": 70,  # Default neutral score (placeholder)
            "velocity": _score_velocity(metrics.star_velocity),
        }

        # Calculate overall score (weighted average of available scores)
        total_weight = 0.0
        weighted_sum = 0.0

        for key, weight in WEIGHTS.items():
            score = scores.get(key)
            if score is not None:
                weighted_sum += score * weight
                total_weight += weight

        overall = weighted_sum / total_weight if total_weight > 0 else 0

        return HealthScoreResult(
            overall_score=round(overall, 1),
            grade=_score_to_grade(overall),
            issue_response_score=scores.get("issue_response"),
            pr_merge_score=scores.get("pr_merge"),
            release_cadence_score=scores.get("release_cadence"),
            bus_factor_score=scores.get("bus_factor"),
            documentation_score=scores.get("documentation"),
            dependency_score=scores.get("dependency"),
            velocity_score=scores.get("velocity"),
            metrics=metrics,
        )


# Module-level convenience functions
_default_scorer: Optional[HealthScorer] = None


def get_health_scorer() -> HealthScorer:
    """Get the default health scorer instance with optional GitHub token."""
    global _default_scorer
    if _default_scorer is None:
        token = os.environ.get(GITHUB_TOKEN_ENV_VAR)
        _default_scorer = HealthScorer(token=token)
        if token:
            logger.info("Health scorer initialized with GitHub token")
    return _default_scorer


async def calculate_health_score(owner: str, repo: str, star_velocity: float = 0.0) -> Optional[HealthScoreResult]:
    """
    Convenience function to calculate health score for a repo.
    Returns None if fetching fails.
    """
    try:
        scorer = get_health_scorer()
        metrics = await scorer.fetch_metrics(owner, repo, star_velocity)
        return scorer.calculate_scores(metrics)
    except Exception as e:
        logger.error(f"Failed to calculate health score for {owner}/{repo}: {e}")
        return None
