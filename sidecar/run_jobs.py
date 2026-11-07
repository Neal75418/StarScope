"""
無頭收集器：不開 GUI 也能收資料。

launchd 每小時執行一次（睡眠期間跳過，開蓋後補跑一次）。做的事與 App 啟動
序列相同、順序也相同——star 同步先於抓取（抓取跑的是當下的追蹤清單，反過來
會漏掉剛同步進來的 repo），同步失敗不擋抓取。

與開著的 App 併發是安全的：抓取的 skip 依據是 DB 裡的 fetched_at（不是行程內
狀態），兩邊會透過 DB 自然互讓；fetch_releases_job 自己有時間戳擋著。
fetch_all_lock 只擋行程內同時，跨行程極端同時的最壞情況是重複抓一輪相同的
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
        backup_ok = _backup_if_stale()

        # 心跳不能對抓取失敗說「ok」：job 把可恢復錯誤吞掉是為了不讓排程中斷，
        # 但 launchd 這邊唯一的診斷面就是這一行——94/94 失敗還寫 ok 的話，
        # 「心跳正常、資料黑洞」的盲區就回來了。補跑的備份失敗也一樣：同目錄的備份是本機資料唯一的保護
        outcome = _describe_fetch(fetch_counts)
        return _with_backup_failure(outcome) if backup_ok is False else outcome
    finally:
        await close_github_service()
        await close_hn_service()


def _describe_fetch(counts: "dict[str, int | str] | None") -> str:
    """把抓取結果翻成心跳字串。

    None＝同一行程內已有一輪抓取在跑（`fetch_all_lock` 是 asyncio.Lock，
    只擋行程內；App 內嵌 sidecar 的排程路徑會發生，collector 行程單獨
    執行時這個分支不可達）。
    """
    if counts is None:
        return "ok (fetch busy elsewhere)"
    if "job_error" in counts:
        return f"degraded (fetch job error: {counts['job_error']})"
    errors = int(counts.get("errors", 0))
    if errors > 0:
        total = errors + int(counts.get("success", 0))
        # 限流時沒打的 repo 也算在 errors 裡：不說明的話看起來像 token 失效或斷網
        cause = "; GitHub rate limited" if counts.get("rate_limited") else ""
        return f"degraded ({errors}/{total} fetch failed{cause})"
    return "ok"


def _with_backup_failure(outcome: str) -> str:
    """把「補跑的備份失敗」併進心跳字串，保留抓取本身的結果。"""
    if outcome == "ok":
        return "degraded (backup failed)"
    if outcome.startswith("degraded (") and outcome.endswith(")"):
        return f"{outcome[:-1]}; backup failed)"
    # 「ok (fetch busy elsewhere)」：抓取由 App 負責不是失敗，備份失敗仍要標出來
    detail = outcome[outcome.find("(") + 1:-1] if outcome.endswith(")") and "(" in outcome else outcome
    return f"degraded (backup failed; {detail})"


def _backup_if_stale() -> bool | None:
    """超過 BACKUP_STALE_HOURS 沒有備份就補一次。回傳 None＝不需要補，True／False＝補跑成功／失敗。"""
    from db.database import DATABASE_PATH
    from services.backup import backup_database, find_latest_backup

    latest = find_latest_backup(str(DATABASE_PATH))
    if latest is not None:
        age = datetime.now(timezone.utc) - latest
        if age < timedelta(hours=BACKUP_STALE_HOURS):
            return None
    print(f"[collector] 備份超過 {BACKUP_STALE_HOURS}h（上次: {latest}），補跑")
    try:
        return backup_database(str(DATABASE_PATH)) is not None
    except OSError as e:
        # 備份目錄建不起來（例如磁碟滿）時 backup_database 會在 create_backup 之外拋錯：
        # 收在這裡，否則整輪 collector 會變成 FAILED，連已經成功的抓取結果都看不到
        print(f"[collector] 備份補跑失敗: {e!r}")
        return False


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
