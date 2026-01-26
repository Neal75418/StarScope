"""
Auto-tagging service for repositories.
Analyzes language, GitHub topics, and description to generate tags.
"""

import json
import logging
import os
import re
from typing import List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from constants import GITHUB_API_TIMEOUT_SECONDS, GITHUB_TOKEN_ENV_VAR
from db.models import Repo, Tag, RepoTag, TagType
from utils.time import utc_now

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"

# Language tag colors (popular languages)
LANGUAGE_COLORS = {
    "python": "#3572A5",
    "javascript": "#f1e05a",
    "typescript": "#3178c6",
    "java": "#b07219",
    "go": "#00ADD8",
    "rust": "#dea584",
    "c++": "#f34b7d",
    "c": "#555555",
    "c#": "#178600",
    "ruby": "#701516",
    "php": "#4F5D95",
    "swift": "#F05138",
    "kotlin": "#A97BFF",
    "scala": "#c22d40",
    "shell": "#89e051",
    "html": "#e34c26",
    "css": "#563d7c",
    "vue": "#41b883",
    "dart": "#00B4AB",
    "elixir": "#6e4a7e",
    "haskell": "#5e5086",
    "lua": "#000080",
    "perl": "#0298c3",
    "r": "#198CE7",
    "julia": "#9558B2",
    "zig": "#ec915c",
}

# Topic tag default color
TOPIC_COLOR = "#6366f1"

# Inferred tag color
INFERRED_COLOR = "#8b5cf6"

# Common tech keywords for description inference
TECH_KEYWORDS = {
    # Frameworks/Libraries
    "framework", "library", "sdk", "api", "cli", "tool", "toolkit",
    # Architecture
    "microservice", "monorepo", "serverless", "distributed",
    # Domains
    "database", "orm", "http", "graphql", "rest", "websocket",
    "machine-learning", "ai", "ml", "deep-learning", "neural",
    "blockchain", "crypto", "web3",
    "devops", "ci-cd", "deployment", "container", "kubernetes", "docker",
    # Categories
    "testing", "benchmark", "monitoring", "logging", "security",
    "parser", "compiler", "interpreter", "runtime",
    "ui", "frontend", "backend", "fullstack",
    "async", "concurrent", "parallel",
}


class TaggerService:
    """Service for auto-tagging repositories."""

    def __init__(self, token: Optional[str] = None, timeout: float = GITHUB_API_TIMEOUT_SECONDS):
        self.token = token
        self.timeout = timeout
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    async def fetch_topics(self, owner: str, repo: str) -> List[str]:
        """Fetch GitHub topics for a repository."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/topics",
                    headers=self.headers,
                )

                if response.status_code == 404:
                    logger.warning(f"Repository not found: {owner}/{repo}")
                    return []

                if response.status_code == 403:
                    logger.warning(f"Rate limited fetching topics for {owner}/{repo}")
                    return []

                if response.status_code != 200:
                    logger.warning(f"Failed to fetch topics for {owner}/{repo}: {response.status_code}")
                    return []

                data = response.json()
                return data.get("names", [])

        except httpx.TimeoutException:
            logger.warning(f"Timeout fetching topics for {owner}/{repo}")
            return []
        except httpx.RequestError as e:
            logger.warning(f"Request error fetching topics for {owner}/{repo}: {e}")
            return []

    @staticmethod
    def extract_keywords(description: Optional[str]) -> List[str]:
        """Extract meaningful keywords from description."""
        if not description:
            return []

        # Normalize and tokenize
        text = description.lower()
        # Split on non-alphanumeric (keeping hyphens for compound words)
        words = re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", text)

        # Find matching tech keywords
        found = []
        for word in words:
            if word in TECH_KEYWORDS:
                found.append(word)
            # Also check compound words in description
            for keyword in TECH_KEYWORDS:
                if "-" in keyword and keyword in text and keyword not in found:
                    found.append(keyword)

        return list(set(found))[:5]  # Limit to 5 inferred tags

    @staticmethod
    def _get_or_create_tag(
        name: str,
        tag_type: str,
        color: Optional[str],
        db: Session
    ) -> Tag:
        """Get existing tag or create new one."""
        # Normalize tag name
        normalized_name = name.lower().strip()

        tag = db.query(Tag).filter(Tag.name == normalized_name).first()
        if tag:
            return tag

        tag = Tag(
            name=normalized_name,
            tag_type=tag_type,
            color=color,
            created_at=utc_now(),
        )
        db.add(tag)
        db.flush()  # Get the ID
        return tag

    @staticmethod
    def _apply_tag(
        repo_id: int,
        tag: Tag,
        source: str,
        confidence: Optional[float],
        db: Session
    ) -> Optional[RepoTag]:
        """Apply a tag to a repo if not already applied."""
        existing = db.query(RepoTag).filter(
            RepoTag.repo_id == repo_id,
            RepoTag.tag_id == tag.id
        ).first()

        if existing:
            return None

        repo_tag = RepoTag(
            repo_id=repo_id,
            tag_id=tag.id,
            source=source,
            confidence=confidence,
            applied_at=utc_now(),
        )
        db.add(repo_tag)
        return repo_tag

    async def auto_tag_repo(self, repo: Repo, db: Session) -> List[Tuple[Tag, str]]:
        """
        Auto-tag a repository.
        Returns list of (tag, source) tuples for newly applied tags.
        """
        applied_tags: List[Tuple[Tag, str]] = []

        # 1. Language tag
        if repo.language:
            lang_lower = repo.language.lower()
            color = LANGUAGE_COLORS.get(lang_lower, "#6b7280")
            tag = self._get_or_create_tag(
                name=repo.language,
                tag_type=TagType.LANGUAGE,
                color=color,
                db=db
            )
            if self._apply_tag(repo.id, tag, "auto", confidence=1.0, db=db):
                applied_tags.append((tag, "auto"))

        # 2. Fetch and apply GitHub topics
        topics = await self.fetch_topics(repo.owner, repo.name)
        if topics:
            # Update repo's topics field
            repo.topics = json.dumps(topics)

            for topic in topics[:10]:  # Limit to 10 topics
                tag = self._get_or_create_tag(
                    name=topic,
                    tag_type=TagType.TOPIC,
                    color=TOPIC_COLOR,
                    db=db
                )
                if self._apply_tag(repo.id, tag, "auto", confidence=1.0, db=db):
                    applied_tags.append((tag, "auto"))

        # 3. Infer tags from description
        keywords = self.extract_keywords(repo.description)
        for keyword in keywords:
            # Skip if already tagged with same name
            existing = db.query(RepoTag).join(Tag).filter(
                RepoTag.repo_id == repo.id,
                Tag.name == keyword
            ).first()
            if existing:
                continue

            tag = self._get_or_create_tag(
                name=keyword,
                tag_type=TagType.INFERRED,
                color=INFERRED_COLOR,
                db=db
            )
            if self._apply_tag(repo.id, tag, "auto", confidence=0.7, db=db):
                applied_tags.append((tag, "auto"))

        db.commit()
        return applied_tags

    def add_custom_tag(
        self,
        repo_id: int,
        tag_name: str,
        color: Optional[str],
        db: Session
    ) -> Optional[Tuple[Tag, RepoTag]]:
        """
        Add a custom (user-defined) tag to a repo.
        Returns (Tag, RepoTag) if successful, None if already exists.
        """
        tag = self._get_or_create_tag(
            name=tag_name,
            tag_type=TagType.CUSTOM,
            color=color or "#6b7280",
            db=db
        )

        repo_tag = self._apply_tag(repo_id, tag, "user", confidence=None, db=db)
        if repo_tag:
            db.commit()
            return tag, repo_tag
        return None

    @staticmethod
    def remove_tag(repo_id: int, tag_id: int, db: Session) -> bool:
        """Remove a tag from a repo."""
        repo_tag = db.query(RepoTag).filter(
            RepoTag.repo_id == repo_id,
            RepoTag.tag_id == tag_id
        ).first()

        if repo_tag:
            db.delete(repo_tag)
            db.commit()
            return True
        return False

    @staticmethod
    def get_repo_tags(repo_id: int, db: Session) -> List[dict]:
        """Get all tags for a repo with metadata."""
        repo_tags = db.query(RepoTag).filter(RepoTag.repo_id == repo_id).all()

        result = []
        for rt in repo_tags:
            result.append({
                "id": rt.tag.id,
                "name": rt.tag.name,
                "type": rt.tag.tag_type,
                "color": rt.tag.color,
                "source": rt.source,
                "confidence": rt.confidence,
                "applied_at": rt.applied_at.isoformat() if rt.applied_at else None,
            })

        return result


# Module-level singleton
_default_tagger: Optional[TaggerService] = None


def get_tagger_service() -> TaggerService:
    """Get the default tagger service instance."""
    global _default_tagger
    if _default_tagger is None:
        token = os.environ.get(GITHUB_TOKEN_ENV_VAR)
        _default_tagger = TaggerService(token=token)
        if token:
            logger.info("Tagger service initialized with GitHub token")
    return _default_tagger


async def auto_tag_repo(repo_id: int, db: Session) -> List[dict]:
    """
    Convenience function to auto-tag a repo.
    Returns list of applied tag info.
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        logger.warning(f"Repo not found: {repo_id}")
        return []

    try:
        tagger = get_tagger_service()
        applied = await tagger.auto_tag_repo(repo, db)
        return [{"name": tag.name, "type": tag.tag_type, "source": source} for tag, source in applied]
    except Exception as e:
        logger.error(f"Failed to auto-tag repo {repo_id}: {e}", exc_info=True)
        return []


async def auto_tag_all_repos(db: Session) -> dict:
    """
    Auto-tag all repos in the watchlist.
    Returns summary stats.
    """
    repos = db.query(Repo).all()
    tagger = get_tagger_service()

    total = len(repos)
    tagged = 0
    tags_applied = 0

    for repo in repos:
        try:
            applied = await tagger.auto_tag_repo(repo, db)
            if applied:
                tagged += 1
                tags_applied += len(applied)
        except Exception as e:
            logger.error(f"Failed to auto-tag {repo.full_name}: {e}", exc_info=True)

    logger.info(f"Auto-tagged {tagged}/{total} repos, {tags_applied} tags applied")

    return {
        "total_repos": total,
        "repos_tagged": tagged,
        "tags_applied": tags_applied,
    }
