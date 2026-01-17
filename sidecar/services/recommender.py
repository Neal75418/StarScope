"""
Recommendation service for finding similar repositories.
Calculates similarity based on topics, language, and star magnitude.
"""

import json
import logging
from typing import List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from db.models import Repo, SimilarRepo, RepoTag, Tag
from utils.time import utc_now

logger = logging.getLogger(__name__)

# Similarity weights
TOPIC_WEIGHT = 0.6
LANGUAGE_WEIGHT = 0.3
STAR_MAGNITUDE_WEIGHT = 0.1

# Minimum similarity score to store
MIN_SIMILARITY_THRESHOLD = 0.1


class RecommenderService:
    """Service for calculating and storing repository similarities."""

    def _get_repo_topics(self, repo: Repo, db: Session) -> Set[str]:
        """Get all topics for a repo (from topics field and topic tags)."""
        topics: Set[str] = set()

        # From repo.topics (JSON array)
        if repo.topics:
            try:
                parsed = json.loads(repo.topics)
                if isinstance(parsed, list):
                    topics.update(t.lower() for t in parsed if isinstance(t, str))
            except json.JSONDecodeError:
                pass

        # From topic tags
        repo_tags = db.query(RepoTag).join(Tag).filter(
            RepoTag.repo_id == repo.id,
            Tag.tag_type == "topic"
        ).all()

        for rt in repo_tags:
            topics.add(rt.tag.name.lower())

        return topics

    def _jaccard_similarity(self, set1: Set[str], set2: Set[str]) -> float:
        """Calculate Jaccard similarity between two sets."""
        if not set1 or not set2:
            return 0.0

        intersection = len(set1 & set2)
        union = len(set1 | set2)

        if union == 0:
            return 0.0

        return intersection / union

    def _star_magnitude_similarity(self, stars1: Optional[int], stars2: Optional[int]) -> float:
        """
        Calculate similarity based on star count magnitude.
        Repos with similar order of magnitude get higher scores.
        """
        if stars1 is None or stars2 is None or stars1 <= 0 or stars2 <= 0:
            return 0.0

        # Use log ratio - repos within same order of magnitude score higher
        import math
        log1 = math.log10(stars1)
        log2 = math.log10(stars2)

        # Difference in orders of magnitude
        diff = abs(log1 - log2)

        # Convert to similarity score (0 diff = 1.0, 3+ orders diff = 0.0)
        if diff >= 3:
            return 0.0

        return 1.0 - (diff / 3.0)

    def calculate_similarity(
        self,
        repo1: Repo,
        repo2: Repo,
        topics1: Set[str],
        topics2: Set[str],
        stars1: Optional[int] = None,
        stars2: Optional[int] = None,
    ) -> Tuple[float, List[str], bool]:
        """
        Calculate similarity score between two repos.
        Returns (score, shared_topics, same_language).
        """
        # Topic similarity (Jaccard)
        topic_score = self._jaccard_similarity(topics1, topics2)
        shared_topics = list(topics1 & topics2)

        # Language similarity
        same_language = False
        language_score = 0.0
        if repo1.language and repo2.language:
            same_language = repo1.language.lower() == repo2.language.lower()
            language_score = 1.0 if same_language else 0.0

        # Star magnitude similarity
        star_score = self._star_magnitude_similarity(stars1, stars2)

        # Weighted combination
        total_score = (
            topic_score * TOPIC_WEIGHT +
            language_score * LANGUAGE_WEIGHT +
            star_score * STAR_MAGNITUDE_WEIGHT
        )

        return total_score, shared_topics, same_language

    def find_similar_repos(
        self,
        repo_id: int,
        db: Session,
        limit: int = 10
    ) -> List[dict]:
        """
        Find similar repos for a given repository.
        Returns cached results from similar_repos table.
        """
        similar_entries = db.query(SimilarRepo).filter(
            SimilarRepo.repo_id == repo_id
        ).order_by(
            SimilarRepo.similarity_score.desc()
        ).limit(limit).all()

        results = []
        for entry in similar_entries:
            similar_repo = entry.similar
            shared = []
            if entry.shared_topics:
                try:
                    shared = json.loads(entry.shared_topics)
                except json.JSONDecodeError:
                    pass

            results.append({
                "repo_id": similar_repo.id,
                "full_name": similar_repo.full_name,
                "description": similar_repo.description,
                "language": similar_repo.language,
                "url": similar_repo.url,
                "similarity_score": entry.similarity_score,
                "shared_topics": shared,
                "same_language": bool(entry.same_language),
            })

        return results

    def calculate_and_store_similarities(
        self,
        repo: Repo,
        db: Session,
        recalculate: bool = False
    ) -> int:
        """
        Calculate similarities for a single repo against all other repos.
        Returns number of similar repos found.
        """
        # Clear existing if recalculating
        if recalculate:
            db.query(SimilarRepo).filter(SimilarRepo.repo_id == repo.id).delete()

        # Get all other repos
        other_repos = db.query(Repo).filter(Repo.id != repo.id).all()

        if not other_repos:
            return 0

        # Get this repo's topics and star count
        repo_topics = self._get_repo_topics(repo, db)

        # Get latest star count from snapshots
        from db.models import RepoSnapshot
        latest_snapshot = db.query(RepoSnapshot).filter(
            RepoSnapshot.repo_id == repo.id
        ).order_by(RepoSnapshot.snapshot_date.desc()).first()
        repo_stars = latest_snapshot.stars if latest_snapshot else None

        count = 0
        now = utc_now()

        for other in other_repos:
            # Get other repo's topics
            other_topics = self._get_repo_topics(other, db)

            # Get other repo's stars
            other_snapshot = db.query(RepoSnapshot).filter(
                RepoSnapshot.repo_id == other.id
            ).order_by(RepoSnapshot.snapshot_date.desc()).first()
            other_stars = other_snapshot.stars if other_snapshot else None

            # Calculate similarity
            score, shared, same_lang = self.calculate_similarity(
                repo, other, repo_topics, other_topics, repo_stars, other_stars
            )

            # Only store if above threshold
            if score >= MIN_SIMILARITY_THRESHOLD:
                # Check if already exists
                existing = db.query(SimilarRepo).filter(
                    SimilarRepo.repo_id == repo.id,
                    SimilarRepo.similar_repo_id == other.id
                ).first()

                if existing:
                    # Update
                    existing.similarity_score = score
                    existing.shared_topics = json.dumps(shared) if shared else None
                    existing.same_language = same_lang
                    existing.calculated_at = now
                else:
                    # Create new
                    similar = SimilarRepo(
                        repo_id=repo.id,
                        similar_repo_id=other.id,
                        similarity_score=score,
                        shared_topics=json.dumps(shared) if shared else None,
                        same_language=same_lang,
                        calculated_at=now,
                    )
                    db.add(similar)

                count += 1

        db.commit()
        return count

    def recalculate_all(self, db: Session) -> dict:
        """
        Recalculate similarities for all repos.
        Returns summary stats.
        """
        repos = db.query(Repo).all()
        total = len(repos)
        processed = 0
        similarities_found = 0

        for repo in repos:
            try:
                count = self.calculate_and_store_similarities(repo, db, recalculate=True)
                similarities_found += count
                processed += 1
            except Exception as e:
                logger.error(f"Failed to calculate similarities for {repo.full_name}: {e}")

        logger.info(f"Recalculated similarities: {processed}/{total} repos, {similarities_found} pairs found")

        return {
            "total_repos": total,
            "processed": processed,
            "similarities_found": similarities_found,
        }


# Module-level singleton
_recommender: Optional[RecommenderService] = None


def get_recommender_service() -> RecommenderService:
    """Get the default recommender service instance."""
    global _recommender
    if _recommender is None:
        _recommender = RecommenderService()
        logger.info("Recommender service initialized")
    return _recommender


async def find_similar_repos(repo_id: int, db: Session, limit: int = 10) -> List[dict]:
    """Convenience function to find similar repos."""
    recommender = get_recommender_service()
    return recommender.find_similar_repos(repo_id, db, limit)


async def calculate_repo_similarities(repo_id: int, db: Session) -> int:
    """Convenience function to calculate similarities for a repo."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        logger.warning(f"Repo not found: {repo_id}")
        return 0

    recommender = get_recommender_service()
    return recommender.calculate_and_store_similarities(repo, db, recalculate=True)


async def recalculate_all_similarities(db: Session) -> dict:
    """Convenience function to recalculate all similarities."""
    recommender = get_recommender_service()
    return recommender.recalculate_all(db)
