"""量測 GitHub 對 star 寫入的次級速率限制門檻。

⚠️ 這支腳本會對你的真實 GitHub 帳號連續發出寫入請求。它不是執行同步功能的必要
條件——`GitHubService._write_star` 已經改成讀取回應中的 `Retry-After` 來退避，
不依賴任何預先量好的常數。

那為什麼還留著它：`Retry-After` 只在真的被限流時才會出現。如果想知道「幾次之後
會被擋」以便調整批次大小，跑這支就會知道。純屬選用。

安全設計：
- TARGET 必須是你**已經 star** 的 repo。PUT 是冪等的，重複 star 不改變任何狀態，
  所以淨效果為零。
- 一被限流就停，不會硬闖。

用法：
    cd sidecar && .venv/bin/python scripts/measure_star_write_limit.py owner/repo
"""
import asyncio
import sys

import httpx
import keyring

MAX_ATTEMPTS = 100


async def main() -> None:
    if len(sys.argv) != 2 or "/" not in sys.argv[1]:
        print("用法: measure_star_write_limit.py owner/repo（必須是你已 star 的 repo）")
        raise SystemExit(2)

    owner, name = sys.argv[1].split("/", 1)
    token = keyring.get_password("starscope", "github_token")
    if not token:
        print("找不到 token（keyring service=starscope, key=github_token）")
        raise SystemExit(1)

    headers = {"Authorization": f"Bearer {token}",
               "Accept": "application/vnd.github+json"}

    async with httpx.AsyncClient(timeout=20) as client:
        # 先確認它真的已被 star，否則這支腳本會實際改變你的帳號狀態
        probe = await client.get(
            f"https://api.github.com/user/starred/{owner}/{name}", headers=headers)
        if probe.status_code != 204:
            print(f"{owner}/{name} 尚未被 star（回應 {probe.status_code}）。"
                  "請改用一個你已 star 的 repo，否則淨效果不為零。")
            raise SystemExit(1)

        for i in range(1, MAX_ATTEMPTS + 1):
            r = await client.put(
                f"https://api.github.com/user/starred/{owner}/{name}", headers=headers)
            remaining = r.headers.get("x-ratelimit-remaining")
            print(f"{i:3d}  status={r.status_code}  remaining={remaining}  "
                  f"retry-after={r.headers.get('retry-after')}")
            if r.status_code in (403, 429):
                print(f"\n第 {i} 次被限流。相關標頭：")
                for k in ("retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"):
                    print(f"  {k}: {r.headers.get(k)}")
                return

    print(f"\n{MAX_ATTEMPTS} 次連續寫入未被限流。")


asyncio.run(main())
