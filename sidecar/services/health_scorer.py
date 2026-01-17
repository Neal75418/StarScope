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


class HealthScorer:
    """Service for calculating project health scores."""

    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS):
        self.token = token
        self.timeout = timeout
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    async def _fetch_json(self, client: httpx.AsyncClient, url: str, params: Optional[Dict] = None) -> Any:
        """Fetch JSON from GitHub API with error handling."""
        try:
            response = await client.get(url, params=params, headers=self.headers)

            if response.status_code == 404:
                return None
            if response.status_code == 403:
                logger.warning(f"Rate limit or forbidden: {url}")
                return None
            if response.status_code == 401:
                logger.error("GitHub API authentication failed")
                return None

            response.raise_for_status()
            return response.json()
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

            # Process repo data
            if isinstance(data["repo"], dict):
                metrics.has_license = data["repo"].get("license") is not None
                metrics.open_issues_count = data["repo"].get("open_issues_count", 0)

            # Process issues (filter out PRs which also appear in issues endpoint)
            if isinstance(data["issues"], list):
                issues = [i for i in data["issues"] if "pull_request" not in i]
                metrics.open_issues_count = len([i for i in issues if i.get("state") == "open"])
                metrics.closed_issues_count = len([i for i in issues if i.get("state") == "closed"])

                # Calculate average response time for closed issues
                response_times = []
                for issue in issues:
                    if issue.get("state") == "closed" and issue.get("created_at") and issue.get("closed_at"):
                        try:
                            created = datetime.fromisoformat(issue["created_at"].replace("Z", "+00:00"))
                            closed = datetime.fromisoformat(issue["closed_at"].replace("Z", "+00:00"))
                            hours = (closed - created).total_seconds() / 3600
                            if hours > 0:
                                response_times.append(hours)
                        except (ValueError, TypeError):
                            pass

                if response_times:
                    metrics.avg_issue_response_hours = sum(response_times) / len(response_times)

            # Process PRs
            if isinstance(data["pulls"], list):
                metrics.open_prs_count = len([p for p in data["pulls"] if p.get("state") == "open"])
                metrics.merged_prs_count = len([p for p in data["pulls"] if p.get("merged_at")])
                metrics.closed_prs_count = len([p for p in data["pulls"] if p.get("state") == "closed" and not p.get("merged_at")])

            # Process releases
            if isinstance(data["releases"], list) and data["releases"]:
                # Filter out drafts
                releases = [r for r in data["releases"] if not r.get("draft")]
                if releases:
                    # Days since last release
                    latest = releases[0]
                    if latest.get("published_at"):
                        try:
                            published = datetime.fromisoformat(latest["published_at"].replace("Z", "+00:00"))
                            metrics.days_since_last_release = (datetime.now(timezone.utc) - published).days
                        except (ValueError, TypeError):
                            pass

                    # Releases in last year
                    one_year_ago = datetime.now(timezone.utc) - timedelta(days=365)
                    for release in releases:
                        if release.get("published_at"):
                            try:
                                published = datetime.fromisoformat(release["published_at"].replace("Z", "+00:00"))
                                if published > one_year_ago:
                                    metrics.releases_last_year += 1
                            except (ValueError, TypeError):
                                pass

            # Process contributors
            if isinstance(data["contributors"], list):
                metrics.contributor_count = len(data["contributors"])
                if metrics.contributor_count > 0:
                    total_contributions = sum(c.get("contributions", 0) for c in data["contributors"])
                    if total_contributions > 0 and data["contributors"]:
                        top_contributions = data["contributors"][0].get("contributions", 0)
                        metrics.top_contributor_percentage = (top_contributions / total_contributions) * 100

            # Process community profile
            if isinstance(data["community"], dict):
                files = data["community"].get("files", {})
                metrics.has_readme = files.get("readme") is not None
                metrics.has_contributing = files.get("contributing") is not None
                metrics.has_code_of_conduct = files.get("code_of_conduct") is not None
                # License might be in community profile too
                if files.get("license"):
                    metrics.has_license = True

        return metrics

    def calculate_scores(self, metrics: HealthMetrics) -> HealthScoreResult:
        """Calculate health scores from metrics."""
        scores: Dict[str, Optional[float]] = {}

        # Issue Response Score (20%)
        # < 24h = 100, < 72h = 80, < 168h (1 week) = 60, < 720h (1 month) = 40, else 20
        if metrics.avg_issue_response_hours is not None:
            hours = metrics.avg_issue_response_hours
            if hours < 24:
                scores["issue_response"] = 100
            elif hours < 72:
                scores["issue_response"] = 80
            elif hours < 168:
                scores["issue_response"] = 60
            elif hours < 720:
                scores["issue_response"] = 40
            else:
                scores["issue_response"] = 20
        else:
            scores["issue_response"] = None

        # PR Merge Rate Score (20%)
        total_prs = metrics.merged_prs_count + metrics.closed_prs_count
        if total_prs > 0:
            merge_rate = (metrics.merged_prs_count / total_prs) * 100
            # 90%+ = 100, 70-90% = 80, 50-70% = 60, 30-50% = 40, <30% = 20
            if merge_rate >= 90:
                scores["pr_merge"] = 100
            elif merge_rate >= 70:
                scores["pr_merge"] = 80
            elif merge_rate >= 50:
                scores["pr_merge"] = 60
            elif merge_rate >= 30:
                scores["pr_merge"] = 40
            else:
                scores["pr_merge"] = 20
        else:
            scores["pr_merge"] = None

        # Release Cadence Score (15%)
        if metrics.days_since_last_release is not None:
            days = metrics.days_since_last_release
            # < 30 days = 100, < 90 = 80, < 180 = 60, < 365 = 40, else 20
            if days < 30:
                scores["release_cadence"] = 100
            elif days < 90:
                scores["release_cadence"] = 80
            elif days < 180:
                scores["release_cadence"] = 60
            elif days < 365:
                scores["release_cadence"] = 40
            else:
                scores["release_cadence"] = 20
        else:
            scores["release_cadence"] = None

        # Bus Factor Score (15%)
        # Based on contributor count and concentration
        if metrics.contributor_count > 0:
            # More contributors = better
            contributor_score = min(100, metrics.contributor_count * 10)
            # Less concentration = better (top contributor < 50% is ideal)
            if metrics.top_contributor_percentage < 30:
                concentration_score = 100
            elif metrics.top_contributor_percentage < 50:
                concentration_score = 80
            elif metrics.top_contributor_percentage < 70:
                concentration_score = 60
            elif metrics.top_contributor_percentage < 90:
                concentration_score = 40
            else:
                concentration_score = 20
            scores["bus_factor"] = (contributor_score + concentration_score) / 2
        else:
            scores["bus_factor"] = None

        # Documentation Score (10%)
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

        scores["documentation"] = doc_points if doc_items > 0 else None

        # Dependency Score (10%) - placeholder, would need package.json analysis
        # For now, we'll base it on whether the project has recent activity
        scores["dependency"] = 70  # Default neutral score

        # Velocity Score (10%)
        if metrics.star_velocity > 0:
            # Normalize velocity: 10+/day = 100, 5+/day = 80, 1+/day = 60, 0.1+/day = 40, else 20
            if metrics.star_velocity >= 10:
                scores["velocity"] = 100
            elif metrics.star_velocity >= 5:
                scores["velocity"] = 80
            elif metrics.star_velocity >= 1:
                scores["velocity"] = 60
            elif metrics.star_velocity >= 0.1:
                scores["velocity"] = 40
            else:
                scores["velocity"] = 20
        else:
            scores["velocity"] = 20

        # Calculate overall score (weighted average of available scores)
        total_weight = 0
        weighted_sum = 0

        for key, weight in WEIGHTS.items():
            score = scores.get(key)
            if score is not None:
                weighted_sum += score * weight
                total_weight += weight

        if total_weight > 0:
            overall = weighted_sum / total_weight
        else:
            overall = 0

        # Determine grade
        grade = self._score_to_grade(overall)

        return HealthScoreResult(
            overall_score=round(overall, 1),
            grade=grade,
            issue_response_score=scores.get("issue_response"),
            pr_merge_score=scores.get("pr_merge"),
            release_cadence_score=scores.get("release_cadence"),
            bus_factor_score=scores.get("bus_factor"),
            documentation_score=scores.get("documentation"),
            dependency_score=scores.get("dependency"),
            velocity_score=scores.get("velocity"),
            metrics=metrics,
        )

    def _score_to_grade(self, score: float) -> str:
        """Convert numeric score to letter grade."""
        if score >= 95:
            return "A+"
        elif score >= 90:
            return "A"
        elif score >= 85:
            return "B+"
        elif score >= 80:
            return "B"
        elif score >= 75:
            return "C+"
        elif score >= 70:
            return "C"
        elif score >= 60:
            return "D"
        else:
            return "F"


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
