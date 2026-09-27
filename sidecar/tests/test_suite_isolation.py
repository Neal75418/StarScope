"""整套測試不能碰到真實的 ~/.starscope。

APScheduler 的 jobstore 用的是真的 DATABASE_URL（services/scheduler.py 的 get_scheduler），
跑 main.py lifespan 的測試會把排程寫進去：下次執行時間、間隔都換成測試用的值。
~/.starscope 是安裝版、開發模式、collector 共用的真實資料，所以 conftest 沒拿到
STARSCOPE_DATA_DIR 時要自己指到暫存目錄。
"""

from pathlib import Path

from db import database


def test_the_database_is_not_the_real_one():
    real = Path.home() / ".starscope"

    assert database.APP_DATA_DIR != real
    assert real not in database.DATABASE_PATH.parents
