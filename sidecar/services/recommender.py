"""
推薦服務，尋找相似的 repo。
基於 topics、語言及 star 量級計算相似度。
"""

import json
import logging
import math
import threading
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from db.models import Repo, SimilarRepo
from services.queries import build_stars_map
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 相似度權重
TOPIC_WEIGHT = 0.6
LANGUAGE_WEIGHT = 0.3
STAR_MAGNITUDE_WEIGHT = 0.1

# 儲存的最低相似度分數
MIN_SIMILARITY_THRESHOLD = 0.1


def _parse_topics_json(topics_json: Optional[str]) -> Set[str]:
    """將 topics JSON 字串解析為小寫 topic 名稱的集合。"""
    if not topics_json:
        return set()
    try:
        parsed = json.loads(topics_json)
        if isinstance(parsed, list):
            return {t.lower() for t in parsed if isinstance(t, str)}
    except json.JSONDecodeError:
        logger.warning("[推薦] topics JSON 解析失敗: %s", repr(topics_json)[:200])
    return set()


def _get_repo_topics(repo: Repo) -> Set[str]:
    """從 repo 的 topics 欄位取得所有 topic。"""
    return _parse_topics_json(repo.topics)


def _jaccard_similarity(set1: Set[str], set2: Set[str]) -> float:
    """計算兩個集合之間的 Jaccard 相似度。"""
    if not set1 or not set2:
        return 0.0

    intersection = len(set1 & set2)
    union = len(set1 | set2)

    return intersection / union if union > 0 else 0.0


def _star_magnitude_similarity(stars1: Optional[int], stars2: Optional[int]) -> float:
    """
    基於 star 數量級計算相似度。
    量級相近的 repo 會獲得較高分數。
    """
    if stars1 is None or stars2 is None or stars1 <= 0 or stars2 <= 0:
        return 0.0

    # 使用 log 比值 — 相同量級的 repo 分數較高
    log1 = math.log10(stars1)
    log2 = math.log10(stars2)

    # 量級差異
    diff = abs(log1 - log2)

    # 轉換為相似度分數（差 0 = 1.0，差 3 級以上 = 0.0）
    if diff >= 3:
        return 0.0

    return 1.0 - (diff / 3.0)


def _upsert_similar_repo(
    db: Session,
    repo_id: int,
    similar_repo_id: int,
    score: float,
    shared: List[str],
    same_lang: bool
) -> None:
    """新增或更新相似 repo 紀錄。"""
    now = utc_now()
    existing = db.query(SimilarRepo).filter(
        SimilarRepo.repo_id == repo_id,
        SimilarRepo.similar_repo_id == similar_repo_id
    ).first()

    if existing:
        existing.similarity_score = score
        existing.shared_topics = json.dumps(shared) if shared else None
        existing.same_language = same_lang
        existing.calculated_at = now
    else:
        similar = SimilarRepo(
            repo_id=repo_id,
            similar_repo_id=similar_repo_id,
            similarity_score=score,
            shared_topics=json.dumps(shared) if shared else None,
            same_language=same_lang,
            calculated_at=now,
        )
        db.add(similar)


def _parse_shared_topics(json_str: Optional[str]) -> List[str]:
    """解析共同 topics 的 JSON 字串。"""
    if not json_str:
        return []
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return []


class RecommenderService:
    """計算並儲存 repo 相似度的服務。"""

    @staticmethod
    def calculate_similarity(
        repo1: Repo,
        repo2: Repo,
        topics1: Set[str],
        topics2: Set[str],
        stars1: Optional[int] = None,
        stars2: Optional[int] = None,
    ) -> Tuple[float, List[str], bool]:
        """
        計算兩個 repo 之間的相似度分數。
        回傳 (score, shared_topics, same_language)。
        """
        # Topic 相似度（Jaccard）
        topic_score = _jaccard_similarity(topics1, topics2)
        shared_topics = list(topics1 & topics2)

        # 語言相似度
        same_language = False
        language_score = 0.0
        if repo1.language and repo2.language:
            same_language = repo1.language.lower() == repo2.language.lower()
            language_score = 1.0 if same_language else 0.0

        # Star 量級相似度
        star_score = _star_magnitude_similarity(stars1, stars2)

        # 加權組合
        total_score = (
            topic_score * TOPIC_WEIGHT +
            language_score * LANGUAGE_WEIGHT +
            star_score * STAR_MAGNITUDE_WEIGHT
        )

        return total_score, shared_topics, same_language

    @staticmethod
    def find_similar_repos(repo_id: int, db: Session, limit: int = 10) -> List[dict]:
        """
        查詢指定 repo 的相似 repo。
        回傳 similar_repos 表中的快取結果，含各維度分數。
        """
        similar_entries = db.query(SimilarRepo).filter(
            SimilarRepo.repo_id == repo_id
        ).order_by(
            SimilarRepo.similarity_score.desc()
        ).limit(limit).all()

        if not similar_entries:
            return []

        # 取得來源 repo 以重新計算子分數
        source_repo = db.query(Repo).filter(Repo.id == repo_id).first()
        source_topics = _get_repo_topics(source_repo) if source_repo else set()

        # 批次載入所有需要的 star 數（1 次查詢取代 N+1）
        all_repo_ids = [repo_id] + [int(e.similar.id) for e in similar_entries]
        stars_map = build_stars_map(db, all_repo_ids)
        source_stars = stars_map.get(repo_id)

        results = []
        for entry in similar_entries:
            similar_repo = entry.similar
            similar_id = int(similar_repo.id)

            # 重新計算各維度分數（開銷低，僅對 limit 筆結果）
            target_topics = _get_repo_topics(similar_repo)
            topic_score = _jaccard_similarity(source_topics, target_topics)

            language_score = 0.0
            if source_repo and source_repo.language and similar_repo.language:
                language_score = 1.0 if source_repo.language.lower() == similar_repo.language.lower() else 0.0

            target_stars = stars_map.get(similar_id)
            magnitude_score = _star_magnitude_similarity(source_stars, target_stars)

            results.append({
                "repo_id": similar_repo.id,
                "full_name": similar_repo.full_name,
                "description": similar_repo.description,
                "language": similar_repo.language,
                "url": similar_repo.url,
                "similarity_score": entry.similarity_score,
                "shared_topics": _parse_shared_topics(entry.shared_topics),
                "same_language": bool(entry.same_language),
                "topic_score": round(topic_score, 3),
                "language_score": round(language_score, 3),
                "magnitude_score": round(magnitude_score, 3),
            })

        return results

    @staticmethod
    def calculate_and_store_similarities(
        repo: Repo,
        db: Session,
        recalculate: bool = False
    ) -> int:
        """
        計算單一 repo 與所有其他 repo 的相似度。
        回傳找到的相似 repo 數量。
        """
        repo_id = int(repo.id)

        # 重新計算時清除既有資料
        if recalculate:
            db.query(SimilarRepo).filter(SimilarRepo.repo_id == repo_id).delete()

        # 取得所有其他 repo
        other_repos = db.query(Repo).filter(Repo.id != repo_id).all()
        if not other_repos:
            return 0

        # 取得此 repo 的 topics 與 star 數
        repo_topics = _get_repo_topics(repo)

        # 批次載入所有 repo 的 star 數（1 次查詢取代 N+1）
        all_ids = [repo_id] + [int(o.id) for o in other_repos]
        stars_map = build_stars_map(db, all_ids)
        repo_stars = stars_map.get(repo_id)

        count = 0
        for other in other_repos:
            other_id = int(other.id)
            other_topics = _get_repo_topics(other)
            other_stars = stars_map.get(other_id)

            score, shared, same_lang = RecommenderService.calculate_similarity(
                repo, other, repo_topics, other_topics, repo_stars, other_stars
            )

            if score >= MIN_SIMILARITY_THRESHOLD:
                _upsert_similar_repo(db, repo_id, other_id, score, shared, same_lang)
                count += 1

        db.commit()
        return count

    def recalculate_all(self, db: Session) -> dict:
        """
        重新計算所有 repo 的相似度。
        使用批量預載 + 上三角矩陣避免重複計算，大幅降低 DB 查詢次數。
        回傳摘要統計。
        """
        repos = db.query(Repo).all()
        total = len(repos)

        if total < 2:
            return {"total_repos": total, "processed": total, "similarities_found": 0}

        # 1. 一次性載入所有 topics 與 stars（3 個查詢取代 3N 個）
        all_ids = [int(r.id) for r in repos]
        stars_map = build_stars_map(db, all_ids)
        topics_map: Dict[int, Set[str]] = {
            int(r.id): _get_repo_topics(r) for r in repos
        }

        # 整體操作為原子性：DELETE + 重算 + COMMIT，任何錯誤都 rollback 以保留舊資料
        try:
            # 2. 清除所有既有相似度紀錄（1 次 DELETE 取代 N 次）
            db.query(SimilarRepo).delete(synchronize_session=False)

            # 3. 上三角矩陣：只計算 (i, j) 其中 i < j，產生雙向紀錄
            now = utc_now()
            similarities_found = 0
            batch: List[SimilarRepo] = []
            FLUSH_SIZE = 500

            for i in range(total):
                repo_a = repos[i]
                id_a = int(repo_a.id)
                topics_a = topics_map[id_a]
                stars_a = stars_map.get(id_a)

                for j in range(i + 1, total):
                    repo_b = repos[j]
                    id_b = int(repo_b.id)
                    topics_b = topics_map[id_b]
                    stars_b = stars_map.get(id_b)

                    score, shared, same_lang = self.calculate_similarity(
                        repo_a, repo_b, topics_a, topics_b, stars_a, stars_b
                    )

                    if score < MIN_SIMILARITY_THRESHOLD:
                        continue

                    shared_json = json.dumps(shared) if shared else None

                    # 雙向寫入 A→B 和 B→A
                    batch.append(SimilarRepo(
                        repo_id=id_a, similar_repo_id=id_b,
                        similarity_score=score, shared_topics=shared_json,
                        same_language=same_lang, calculated_at=now,
                    ))
                    batch.append(SimilarRepo(
                        repo_id=id_b, similar_repo_id=id_a,
                        similarity_score=score, shared_topics=shared_json,
                        same_language=same_lang, calculated_at=now,
                    ))
                    similarities_found += 1

                    # 4. 每 FLUSH_SIZE 筆批量寫入
                    if len(batch) >= FLUSH_SIZE:
                        db.bulk_save_objects(batch)
                        batch.clear()

            # 寫入剩餘紀錄
            if batch:
                db.bulk_save_objects(batch)
                batch.clear()

            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"[推薦] 相似度重新計算失敗，已回滾: {e}", exc_info=True)
            raise

        logger.info(
            f"[推薦] 相似度重新計算完成: {total} 個 repo、"
            f"找到 {similarities_found} 組配對"
        )

        return {
            "total_repos": total,
            "processed": total,
            "similarities_found": similarities_found,
        }


# 模組層級 singleton
_recommender: Optional[RecommenderService] = None
_recommender_lock = threading.Lock()


def get_recommender_service() -> RecommenderService:
    """取得預設的推薦服務實例（使用 double-checked locking）。"""
    global _recommender
    if _recommender is None:
        with _recommender_lock:
            if _recommender is None:
                _recommender = RecommenderService()
                logger.info("[推薦] 推薦服務已初始化")
    return _recommender


def find_similar_repos(repo_id: int, db: Session, limit: int = 10) -> List[dict]:
    """查詢相似 repo 的便利函式。"""
    return RecommenderService.find_similar_repos(repo_id, db, limit)


def calculate_repo_similarities(repo_id: int, db: Session) -> int:
    """計算 repo 相似度的便利函式。"""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        logger.warning(f"[推薦] 找不到 repo: {repo_id}")
        return 0

    return RecommenderService.calculate_and_store_similarities(repo, db, recalculate=True)


def recalculate_all_similarities(db: Session) -> dict:
    """重新計算所有相似度的便利函式。"""
    recommender = get_recommender_service()
    return recommender.recalculate_all(db)
