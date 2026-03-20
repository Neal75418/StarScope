"""
推薦服務，尋找相似的 repo。
基於 topics、語言及 star 量級計算相似度。
"""

import json
import logging
import math
import threading

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from db.models import Repo, SimilarRepo
from services.queries import build_stars_map, build_signal_map
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 相似度權重
TOPIC_WEIGHT = 0.6
LANGUAGE_WEIGHT = 0.3
STAR_MAGNITUDE_WEIGHT = 0.1

# 儲存的最低相似度分數
MIN_SIMILARITY_THRESHOLD = 0.1


def _parse_topics_json(topics_json: str | None) -> set[str]:
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


def _get_repo_topics(repo: Repo) -> set[str]:
    """從 repo 的 topics 欄位取得所有 topic。"""
    # noinspection PyTypeChecker
    return _parse_topics_json(repo.topics)


def _jaccard_similarity(set1: set[str], set2: set[str]) -> float:
    """計算兩個集合之間的 Jaccard 相似度。"""
    if not set1 or not set2:
        return 0.0

    intersection = len(set1 & set2)
    union = len(set1 | set2)

    return intersection / union if union > 0 else 0.0


def _star_magnitude_similarity(stars1: int | None, stars2: int | None) -> float:
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
    shared: list[str],
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


def _upsert_similar_repo_cached(
    db: Session,
    repo_id: int,
    similar_repo_id: int,
    score: float,
    shared: list[str],
    same_lang: bool,
    existing_map: dict[int, "SimilarRepo"],
) -> None:
    """使用預載的 existing_map 新增或更新相似 repo 紀錄（無額外 DB 查詢）。"""
    now = utc_now()
    existing = existing_map.get(similar_repo_id)

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
        existing_map[similar_repo_id] = similar


def _parse_shared_topics(json_str: str | None) -> list[str]:
    """解析共同 topics 的 JSON 字串。"""
    if not json_str:
        return []
    try:
        result: list[str] = json.loads(json_str)
        return result
    except json.JSONDecodeError:
        return []


def _preload_all_data(db: Session) -> tuple[list[Repo], dict[int, int | None], dict[int, set[str]]]:
    """
    預載所有 repo 資料及其相關資訊（stars、topics）。
    回傳 (repos, stars_map, topics_map)。
    """
    # noinspection PyTypeChecker
    repos: list[Repo] = db.query(Repo).all()
    # noinspection PyTypeChecker
    all_ids = [int(r.id) for r in repos]
    stars_map = build_stars_map(db, all_ids)
    # noinspection PyTypeChecker
    topics_map: dict[int, set[str]] = {
        int(r.id): _get_repo_topics(r) for r in repos
    }
    return repos, stars_map, topics_map


def _calculate_pairwise_similarities(
    repos: list[Repo],
    stars_map: dict[int, int | None],
    topics_map: dict[int, set[str]],
    calculate_similarity_fn,
) -> tuple[list[SimilarRepo], int]:
    """
    使用上三角矩陣計算所有 repo 的兩兩相似度。
    回傳 (相似度紀錄列表, 配對總數)。
    """
    total = len(repos)
    now = utc_now()
    similarities: list[SimilarRepo] = []
    similarities_found = 0

    for i in range(total):
        repo_a = repos[i]
        # noinspection PyTypeChecker
        id_a = int(repo_a.id)
        topics_a = topics_map[id_a]
        stars_a = stars_map.get(id_a)

        for j in range(i + 1, total):
            repo_b = repos[j]
            # noinspection PyTypeChecker
            id_b = int(repo_b.id)
            topics_b = topics_map[id_b]
            stars_b = stars_map.get(id_b)

            score, shared, same_lang = calculate_similarity_fn(
                repo_a, repo_b, topics_a, topics_b, stars_a, stars_b
            )

            if score < MIN_SIMILARITY_THRESHOLD:
                continue

            shared_json = json.dumps(shared) if shared else None

            # 雙向寫入 A→B 和 B→A
            similarities.append(SimilarRepo(
                repo_id=id_a, similar_repo_id=id_b,
                similarity_score=score, shared_topics=shared_json,
                same_language=same_lang, calculated_at=now,
            ))
            similarities.append(SimilarRepo(
                repo_id=id_b, similar_repo_id=id_a,
                similarity_score=score, shared_topics=shared_json,
                same_language=same_lang, calculated_at=now,
            ))
            similarities_found += 1

    return similarities, similarities_found


class RecommenderService:
    """計算並儲存 repo 相似度的服務。"""

    @staticmethod
    def calculate_similarity(
        repo1: Repo,
        repo2: Repo,
        topics1: set[str],
        topics2: set[str],
        stars1: int | None = None,
        stars2: int | None = None,
    ) -> tuple[float, list[str], bool]:
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
    def find_similar_repos(repo_id: int, db: Session, limit: int = 10) -> list[dict]:
        """
        查詢指定 repo 的相似 repo。
        回傳 similar_repos 表中的快取結果，含各維度分數。
        """
        similar_entries = db.query(SimilarRepo).options(
            joinedload(SimilarRepo.similar)
        ).filter(
            SimilarRepo.repo_id == repo_id
        ).order_by(
            SimilarRepo.similarity_score.desc()
        ).limit(limit).all()

        if not similar_entries:
            return []

        # 取得來源 repo 以重新計算子分數
        # noinspection PyTypeChecker
        source_repo: Repo | None = db.query(Repo).filter(Repo.id == repo_id).first()
        source_topics = _get_repo_topics(source_repo) if source_repo else set()

        # 批次載入所有需要的 star 數（1 次查詢取代 N+1）
        # noinspection PyTypeChecker
        all_repo_ids = [repo_id] + [int(e.similar.id) for e in similar_entries]
        stars_map = build_stars_map(db, all_repo_ids)
        source_stars = stars_map.get(repo_id)

        results = []
        for entry in similar_entries:
            # noinspection PyTypeChecker
            similar_repo: Repo = entry.similar
            # noinspection PyTypeChecker
            similar_id = int(similar_repo.id)

            # 重新計算各維度分數（開銷低，僅對 limit 筆結果）
            target_topics = _get_repo_topics(similar_repo)
            topic_score = _jaccard_similarity(source_topics, target_topics)

            language_score = 0.0
            if source_repo and source_repo.language and similar_repo.language:
                language_score = 1.0 if source_repo.language.lower() == similar_repo.language.lower() else 0.0

            target_stars = stars_map.get(similar_id)
            magnitude_score = _star_magnitude_similarity(source_stars, target_stars)

            # noinspection PyTypeChecker
            shared_topics_list = _parse_shared_topics(entry.shared_topics)

            results.append({
                "repo_id": similar_repo.id,
                "full_name": similar_repo.full_name,
                "description": similar_repo.description,
                "language": similar_repo.language,
                "url": similar_repo.url,
                "similarity_score": entry.similarity_score,
                "shared_topics": shared_topics_list,
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
        # noinspection PyTypeChecker
        repo_id = int(repo.id)

        # 重新計算時清除既有資料
        if recalculate:
            db.query(SimilarRepo).filter(SimilarRepo.repo_id == repo_id).delete()

        # 取得所有其他 repo
        # noinspection PyTypeChecker
        other_repos: list[Repo] = db.query(Repo).filter(Repo.id != repo_id).all()
        if not other_repos:
            return 0

        # 取得此 repo 的 topics 與 star 數
        repo_topics = _get_repo_topics(repo)

        # 批次載入所有 repo 的 star 數（1 次查詢取代 N+1）
        # noinspection PyTypeChecker
        all_ids = [repo_id] + [int(o.id) for o in other_repos]
        stars_map = build_stars_map(db, all_ids)
        repo_stars = stars_map.get(repo_id)

        # 預載此 repo 的所有現有 SimilarRepo（1 次查詢取代 N 次）
        existing_records = db.query(SimilarRepo).filter(
            SimilarRepo.repo_id == repo_id
        ).all()
        existing_map = {int(r.similar_repo_id): r for r in existing_records}

        count = 0
        for other in other_repos:
            # noinspection PyTypeChecker
            other_id = int(other.id)
            other_topics = _get_repo_topics(other)
            other_stars = stars_map.get(other_id)

            score, shared, same_lang = RecommenderService.calculate_similarity(
                repo, other, repo_topics, other_topics, repo_stars, other_stars
            )

            if score >= MIN_SIMILARITY_THRESHOLD:
                _upsert_similar_repo_cached(
                    db, repo_id, other_id, score, shared, same_lang, existing_map
                )
                count += 1

        db.commit()
        return count

    def recalculate_all(self, db: Session) -> dict:
        """
        重新計算所有 repo 的相似度。
        使用批量預載 + 上三角矩陣避免重複計算，大幅降低 DB 查詢次數。
        回傳摘要統計。
        """
        # 1. 預載所有資料
        repos, stars_map, topics_map = _preload_all_data(db)
        total = len(repos)

        if total < 2:
            return {"total_repos": total, "processed": total, "similarities_found": 0}

        # 2. 整體操作為原子性：DELETE + 重算 + COMMIT，任何錯誤都 rollback 以保留舊資料
        try:
            # 清除所有既有相似度紀錄（1 次 DELETE 取代 N 次）
            db.query(SimilarRepo).delete(synchronize_session=False)

            # 3. 計算兩兩相似度（上三角矩陣）
            similarities, similarities_found = _calculate_pairwise_similarities(
                repos, stars_map, topics_map, self.calculate_similarity
            )

            # 4. 批量寫入相似度紀錄
            flush_size = 500
            for i in range(0, len(similarities), flush_size):
                batch = similarities[i:i + flush_size]
                db.bulk_save_objects(batch)

            db.commit()
        except SQLAlchemyError as e:
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
_recommender: RecommenderService | None = None
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


def find_similar_repos(repo_id: int, db: Session, limit: int = 10) -> list[dict]:
    """查詢相似 repo 的便利函式。"""
    return RecommenderService.find_similar_repos(repo_id, db, limit)


def calculate_repo_similarities(repo_id: int, db: Session) -> int:
    """計算 repo 相似度的便利函式。"""
    # noinspection PyTypeChecker
    repo: Repo | None = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        logger.warning(f"[推薦] 找不到 repo: {repo_id}")
        return 0

    return RecommenderService.calculate_and_store_similarities(repo, db, recalculate=True)


def recalculate_all_similarities(db: Session) -> dict:
    """重新計算所有相似度的便利函式。"""
    recommender = get_recommender_service()
    return recommender.recalculate_all(db)


def _velocity_boost(velocity: float | None) -> float:
    """根據 velocity 計算推薦加權。成長中的 repo 獲得更高推薦分數。"""
    if velocity is None or velocity <= 0:
        return 0.0
    if velocity > 10:
        return 0.3
    if velocity > 5:
        return 0.15
    return 0.05


def get_personalized_recommendations(db: Session, limit: int = 10) -> dict:
    """
    根據用戶 watchlist 中的 repo 相似度與動量，推薦最值得關注的 repo。

    演算法：
    1. 取得 watchlist 中所有 repo 的相似度配對
    2. 聚合每個 repo 從不同來源 repo 獲得的相似度分數
    3. 以 similarity_score × (1 + velocity_boost) 排序
    4. 取 top N，附帶推薦理由（來源 repo 與共同 topic）
    """
    # 取得全部 watchlist repo
    all_repos: list[Repo] = db.query(Repo).all()
    if not all_repos:
        return {"recommendations": [], "total": 0, "based_on_repos": 0}

    # noinspection PyTypeChecker
    watchlist_ids: set[int] = {int(r.id) for r in all_repos}
    repo_name_map: dict[int, str] = {int(r.id): str(r.full_name) for r in all_repos}

    # 查詢所有相似 repo 配對（joinedload 避免 N+1 lazy load）
    similar_entries = (
        db.query(SimilarRepo)
        .options(joinedload(SimilarRepo.similar))
        .filter(SimilarRepo.repo_id.in_(watchlist_ids))
        .order_by(SimilarRepo.similarity_score.desc())
        .all()
    )

    if not similar_entries:
        return {
            "recommendations": [],
            "total": 0,
            "based_on_repos": len(watchlist_ids),
        }

    # 收集所有被推薦的 repo ID，批次載入 signal 與 star 資料
    # noinspection PyTypeChecker
    recommended_ids: list[int] = list({int(e.similar_repo_id) for e in similar_entries})
    signal_map = build_signal_map(db, recommended_ids)
    stars_map = build_stars_map(db, recommended_ids)

    # 對每個被推薦 repo 取最高 adjusted_score 的來源
    # key = similar_repo_id, value = best entry info
    best_per_repo: dict[int, dict] = {}

    for entry in similar_entries:
        # noinspection PyTypeChecker
        target_id = int(entry.similar_repo_id)
        # noinspection PyTypeChecker
        source_id = int(entry.repo_id)

        # velocity boost
        signals = signal_map.get(target_id, {})
        velocity = signals.get("velocity")
        trend_val = signals.get("trend")
        boost = _velocity_boost(velocity)
        adjusted_score = float(entry.similarity_score) * (1 + boost)

        if target_id not in best_per_repo or adjusted_score > best_per_repo[target_id]["adjusted_score"]:
            shared_topics = _parse_shared_topics(entry.shared_topics)
            source_name = repo_name_map.get(source_id, f"repo #{source_id}")

            target_repo: Repo = entry.similar
            best_per_repo[target_id] = {
                "repo_id": target_id,
                "full_name": str(target_repo.full_name),
                "description": target_repo.description,
                "language": target_repo.language,
                "url": str(target_repo.url),
                "stars": stars_map.get(target_id),
                "velocity": velocity,
                "trend": int(trend_val) if trend_val is not None else None,
                "similarity_score": round(float(entry.similarity_score), 3),
                "shared_topics": shared_topics[:3],
                "same_language": bool(entry.same_language),
                "source_repo_id": source_id,
                "source_repo_name": source_name,
                "adjusted_score": adjusted_score,
            }

    # 按 adjusted_score 排序取 top N
    sorted_recs = sorted(
        best_per_repo.values(),
        key=lambda r: r["adjusted_score"],
        reverse=True,
    )[:limit]

    # 移除內部用的 adjusted_score 欄位
    for rec in sorted_recs:
        del rec["adjusted_score"]

    return {
        "recommendations": sorted_recs,
        "total": len(sorted_recs),
        "based_on_repos": len(watchlist_ids),
    }
