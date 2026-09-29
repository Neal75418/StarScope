"""資料庫路徑轉成連線 URL 之後，要能原樣拿回同一個路徑。

SQLAlchemy 2.1 起，URL 的 database 段會先做 percent-decode：路徑裡有 "%41" 這種字串時，
直接拼字串的 URL 會被解成 "A"，sidecar 開不了資料庫；解出來的目錄剛好存在的話，
會安靜地開到另一個資料庫。資料目錄可以由 STARSCOPE_DATA_DIR 或使用者名稱決定，不能假設它乾淨。
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url

from db.database import create_app_engine, sqlite_url

AWKWARD_NAMES = ["u%41x", "100%", "有 空白", "a#b", "a+b", "a?b=c"]


@pytest.mark.parametrize("name", AWKWARD_NAMES)
def test_the_url_round_trips_to_the_same_path(tmp_path, name):
    path = tmp_path / name / "starscope.db"
    assert make_url(sqlite_url(path)).database == str(path)


@pytest.mark.parametrize("name", AWKWARD_NAMES)
def test_the_engine_opens_the_file_at_that_path(tmp_path, name):
    path: Path = tmp_path / name / "starscope.db"
    path.parent.mkdir()
    engine = create_app_engine(sqlite_url(path))
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE probe (x INTEGER)"))
        assert path.is_file()
        assert inspect(engine).has_table("probe")
    finally:
        engine.dispose()


def test_the_app_database_url_uses_it(tmp_path):
    # 上面兩條只驗 sqlite_url 本身；這條驗 DATABASE_URL 真的用它。資料目錄在模組 import 時就決定，
    # 所以開一個子行程、帶著怪路徑去 import，看 URL 解回來是不是同一個檔案
    data_dir = tmp_path / "u%41x"
    probe = (
        "import json; from sqlalchemy.engine import make_url; from db import database as d; "
        "print(json.dumps([make_url(d.DATABASE_URL).database, str(d.DATABASE_PATH)]))"
    )
    env = {**os.environ, "STARSCOPE_DATA_DIR": str(data_dir),
           "PYTHON_KEYRING_BACKEND": "keyring.backends.null.Keyring", "GITHUB_TOKEN": ""}
    out = subprocess.run([sys.executable, "-c", probe], cwd=Path(__file__).resolve().parents[1],
                         env=env, capture_output=True, text=True, check=True).stdout
    url_path, db_path = json.loads(out.strip().splitlines()[-1])
    assert db_path == str(data_dir / "starscope.db")
    assert url_path == db_path
