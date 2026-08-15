"""讓「排除已封存的 repo」成為所有 SELECT 的預設。

為什麼不是在每個查詢加條件：repo 的查詢點有 29 處，而且需要相反的行為——列表與
計數必須排除封存的，依 full_name 或 id 的查找卻必須找得到它們（full_name 是唯一鍵，
看不到封存的列會讓重新 star 時 INSERT 撞鍵回 500）。在 29 個地方各判斷一次，
漏一個就是滲漏；把預設反過來之後，要記得的地方只剩下少數需要 opt-out 的查詢。

兩個已實測的邊界，改動前先讀：

- 只攔截 SELECT。bulk delete/update 不受影響——「清空所有資料」必須真的清空。
- 關聯載入會回 None 而不是滲漏。指向封存 repo 的 relationship 取得 None，
  呼叫端若直接當成物件使用會拋 AttributeError（見 services/recommender.py）。
"""
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from db.models import Repo

INCLUDE_ARCHIVED = "include_archived"

_installed = False


def install_archive_filter() -> None:
    """註冊事件。應用程式啟動時呼叫一次；重複呼叫是安全的。"""
    global _installed
    if _installed:
        return

    @event.listens_for(Session, "do_orm_execute")
    def _exclude_archived(state: Any) -> None:
        if not state.is_select or state.execution_options.get(INCLUDE_ARCHIVED):
            return
        state.statement = state.statement.options(
            with_loader_criteria(Repo, Repo.unstarred_at.is_(None), include_aliases=True)
        )

    _installed = True


def include_archived(query: Any) -> Any:
    """讓這一次查詢看得到封存的 repo。"""
    return query.execution_options(**{INCLUDE_ARCHIVED: True})
