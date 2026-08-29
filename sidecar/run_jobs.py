"""
無頭收集器：不開 GUI 也能收資料。

launchd 每小時執行一次（睡眠期間跳過，開蓋後補跑一次）。做的事與 App 啟動
序列相同、順序也相同——star 同步先於抓取（抓取跑的是當下的追蹤清單，反過來
會漏掉剛同步進來的 repo），同步失敗不擋抓取。

與開著的 App 併發是安全的：抓取的 skip 依據是 DB 裡的 fetched_at（不是行程內
狀態），兩邊會透過 DB 自然互讓；fetch_releases_job 自己有時間戳擋著。
_fetch_all_lock 只擋行程內同時，跨行程極端同時的最壞情況是重複抓一輪相同的
值，寫入冪等。

離線時在預檢就退出（exit 0）：不對 94 個 repo 各失敗一次灌爆失敗計數器，
下一個小時 launchd 自然重試——節奏本身就是重試機制。
"""
import asyncio
import socket
import sys
import time
from datetime import datetime, timedelta, timezone

# 單次執行的總時限。實測全量抓取 45 秒上下，15 分鐘是約 20 倍餘裕；
# 超過代表卡死（例如 DNS 黑洞），讓 launchd 下一輪重來比掛著好。
RUN_TIMEOUT_SECONDS = 900

# 備份補跑門檻：cron 02:00 只在 App 恰好開著時觸發，收集器負責兜底。
BACKUP_STALE_HOURS = 24


def _online(host: str = "api.github.com", port: int = 443, timeout: float = 3.0) -> bool:
    """能不能碰到 GitHub。DNS 失敗與連線失敗都視為離線。"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


async def run_once() -> str:
    """跑一輪收集。回傳結果字串（給 log 與測試用）。"""
    from db.database import SessionLocal, init_db

    init_db()

    if not _online():
        return "offline-skip"

    from services.github import close_github_service, get_github_service
    from services.hacker_news import close_hn_service
    from services.scheduler import (
        check_alerts_job,
        fetch_all_repos_job,
        fetch_context_signals_job,
        fetch_releases_job,
    )
    from services.star_sync import sync_starred_repos

    try:
        # ① star 同步——失敗不擋抓取（沒有新 star 時既有清單仍該更新）
        db = SessionLocal()
        try:
            result = await sync_starred_repos(db, get_github_service())
            if result.skipped_reason:
                print(f"[collector] star 同步略過: {result.skipped_reason}")
        except Exception as e:  # noqa: BLE001 — 與 main.py 啟動序列相同的容錯
            print(f"[collector] star 同步失敗（已忽略）: {e}")
        finally:
            db.close()

        # ② 抓取（內含早期訊號偵測與 health 更新）→ ③ 警報 → ④ HN → ⑤ 版本
        fetch_counts = await fetch_all_repos_job()
        check_alerts_job()
        await fetch_context_signals_job()
        await fetch_releases_job()

        # ⑥ 備份兜底：超過 24 小時沒備份就補一次
        _backup_if_stale()

        # 心跳不能對抓取失敗說「ok」：job 把可恢復錯誤吞掉是為了不讓排程中斷，
        # 但 launchd 這邊唯一的診斷面就是這一行——94/94 失敗還寫 ok 的話，
        # 「心跳正常、資料黑洞」的盲區就回來了
        return _describe_fetch(fetch_counts)
    finally:
        await close_github_service()
        await close_hn_service()


def _describe_fetch(counts: "dict[str, int | str] | None") -> str:
    """把抓取結果翻成心跳字串。None＝鎖被 App 行程持有，資料由它負責，算 ok。"""
    if counts is None:
        return "ok (fetch busy elsewhere)"
    if counts.get("job_error"):
        return f"degraded (fetch job error: {counts['job_error']})"
    errors = int(counts.get("errors", 0))
    if errors > 0:
        total = errors + int(counts.get("success", 0))
        return f"degraded ({errors}/{total} fetch failed)"
    return "ok"


def _backup_if_stale() -> None:
    from db.database import DATABASE_PATH
    from services.backup import backup_database, find_latest_backup

    latest = find_latest_backup(str(DATABASE_PATH))
    if latest is not None:
        age = datetime.now(timezone.utc) - latest
        if age < timedelta(hours=BACKUP_STALE_HOURS):
            return
    print(f"[collector] 備份超過 {BACKUP_STALE_HOURS}h（上次: {latest}），補跑")
    backup_database(str(DATABASE_PATH))


def main() -> int:
    started = time.monotonic()
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        outcome = asyncio.run(asyncio.wait_for(run_once(), RUN_TIMEOUT_SECONDS))
    except Exception as e:  # noqa: BLE001 — 心跳行必須寫出來，launchd 靠它可診斷
        print(f"[collector] {stamp} FAILED after {time.monotonic()-started:.0f}s: {e!r}")
        return 1
    print(f"[collector] {stamp} {outcome} in {time.monotonic()-started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
