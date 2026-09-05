"""既有資料庫的欄位補齊測試。

為什麼需要這個檔案：Base.metadata.create_all() 只建新表，對已存在的表完全不動。
所以在模型上加欄位，對開發者的空資料庫是無感的，對使用者既有的資料庫卻會在
第一次查詢時炸「no such column」——這個落差只有在真實的舊資料庫上才看得見，
一般的端點測試每次都從空白 schema 起跑，永遠測不到。
"""
import pytest
import sqlalchemy as sa

from db.database import SchemaNeedsMigration, ensure_columns
from db.models import Base


def _columns(engine: sa.Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(sa.text(f"PRAGMA table_info({table})"))}


def _old_db(path, omit: dict[str, list[str]]) -> sa.Engine:
    """造一個「使用者的舊資料庫」：用目前的 model 建表，再刪掉指定欄位。

    比手寫 CREATE TABLE 真實——欄位、型別、約束都與正式 schema 一致，而且不會
    隨 model 演進而腐爛。手寫骨架漏掉某個 NOT NULL 欄位時，測到的就不再是
    「使用者的舊資料庫」，而是一個現實中不存在的形狀。
    """
    engine = sa.create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for table, cols in omit.items():
            for c in cols:
                conn.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN {c}"))
    return engine


def test_missing_columns_are_restored_without_touching_rows(tmp_path):
    """跨多張表一次補齊，既有資料原封不動。

    這幾個欄位正是專案演進中陸續加上的（repos 的 star 狀態、context_signals
    的 tags、early_signals 的訊號模板參數）——真實使用者的舊資料庫就是缺這些。
    """
    omit = {
        "repos": ["starred_at", "unstarred_at"],
        "context_signals": ["tags"],
        "early_signals": ["baseline_value", "context_title"],
    }
    engine = _old_db(tmp_path / "old.db", omit)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO repos (id, owner, name, full_name, url, added_at, updated_at) "
            "VALUES (1, 'a', 'one', 'a/one', 'https://github.com/a/one', "
            "'2026-01-01', '2026-01-01')"
        ))

    for table, cols in omit.items():
        assert not set(cols) & _columns(engine, table), f"{table} 的前提不成立"

    ensure_columns(engine)

    for table, cols in omit.items():
        assert set(cols) <= _columns(engine, table), f"{table} 沒補齊"

    with engine.connect() as conn:
        row = conn.execute(sa.text(
            "SELECT full_name, starred_at, unstarred_at FROM repos WHERE id = 1")).one()
    assert row[0] == "a/one", "既有資料必須原封不動"
    assert row[1] is None and row[2] is None, "補上的欄位對既有列應為 NULL"


def test_source_of_truth_is_the_model_not_a_hand_written_list(tmp_path):
    """任一個可為空的欄位被刪掉都補得回來——不需要在任何地方登記。

    先前靠手工維護的清單：漏登記時開發者的空資料庫由 create_all() 建好、
    一切正常，只有既有使用者會炸，而那是本機重現不出來的。改成從 model
    metadata 推導後，「忘了登記」這個失敗模式不存在。
    """
    # 刻意挑「從來沒有出現在任何登記清單裡」的欄位——它們從初始 schema
    # 就存在，所以舊機制永遠不會補它們。能補回來才證明來源是 model 而非清單。
    # （被索引或約束涵蓋的欄位 SQLite 不允許 DROP，所以取樣限於可刪的那些）
    never_registered = ["velocity_value", "star_count", "percentile_rank"]

    engine = _old_db(tmp_path / "any.db", {"early_signals": never_registered})
    assert not set(never_registered) & _columns(engine, "early_signals")

    ensure_columns(engine)

    assert set(never_registered) <= _columns(engine, "early_signals")


def test_running_twice_is_a_no_op(tmp_path):
    """啟動時每次都會跑，所以重複執行不能出錯。"""
    engine = _old_db(tmp_path / "twice.db", {"repos": ["starred_at"]})

    ensure_columns(engine)
    ensure_columns(engine)  # 不該拋 duplicate column name

    assert "starred_at" in _columns(engine, "repos")


def test_absent_table_is_skipped(tmp_path):
    """全新資料庫在 create_all 之前沒有任何表，這裡不該試圖 ALTER 不存在的表。"""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")

    ensure_columns(engine)  # 不該拋 no such table

    assert _columns(engine, "repos") == set()


def test_not_null_without_default_fails_loudly(tmp_path):
    """補不了的差異要當場拋錯，不能默默跳過。

    SQLite 本來就不允許對既有表加「NOT NULL 又沒有預設值」的欄位。默默跳過的話
    app 會照常啟動，然後在某個查詢碰到那個欄位時才炸——更晚、更難追。
    這個例外就是「該正式引入 alembic 了」的訊號。
    """
    engine = _old_db(tmp_path / "notnull.db", {"repos": ["updated_at"]})

    with pytest.raises(SchemaNeedsMigration, match="repos.updated_at"):
        ensure_columns(engine)


def _with_extra_columns(table_name: str, *cols: sa.Column) -> sa.MetaData:
    """拋棄式 MetaData：複製正式的表定義再多掛幾個欄位，不動全域的 Base.metadata。"""
    md = sa.MetaData()
    table = Base.metadata.tables[table_name].to_metadata(md)
    for c in cols:
        table.append_column(c)
    return md


def _insert_repo(conn, id_: int) -> None:
    conn.execute(sa.text(
        "INSERT INTO repos (id, owner, name, full_name, url, added_at, updated_at) "
        f"VALUES ({id_}, 'a', 'r{id_}', 'a/r{id_}', 'https://github.com/a/r{id_}', "
        "'2026-01-01', '2026-01-01')"
    ))


def test_not_null_with_server_default_keeps_both_constraints(tmp_path):
    """文件承諾支援「NOT NULL + server_default」，補上去的欄位就必須真的帶著這兩個約束。

    先前 DDL 只產型別，NOT NULL 與 DEFAULT 都被丟掉：既有列全 NULL、ORM 省略該欄位的
    INSERT 也寫 NULL，而 SQLite 對此完全不吭聲——正是這套機制要消滅的「開發者的
    空資料庫正常、只有既有使用者壞掉」。
    """
    engine = _old_db(tmp_path / "default.db", {})
    with engine.begin() as conn:
        _insert_repo(conn, 1)
    md = _with_extra_columns(
        "repos", sa.Column("flag", sa.Integer, nullable=False, server_default=sa.text("7"))
    )

    ensure_columns(engine, metadata=md)

    with engine.begin() as conn:
        info = {r[1]: r for r in conn.execute(sa.text("PRAGMA table_info(repos)"))}["flag"]
        assert info[3] == 1, "NOT NULL 必須保留"
        assert info[4] == "7", "DEFAULT 必須保留"
        assert conn.execute(sa.text("SELECT flag FROM repos WHERE id = 1")).scalar() == 7, \
            "既有列要拿到預設值"
        _insert_repo(conn, 2)  # 省略 flag，如同 ORM 對 server_default 欄位的 INSERT
        assert conn.execute(sa.text("SELECT flag FROM repos WHERE id = 2")).scalar() == 7, \
            "省略該欄位的新列也要拿到預設值"


@pytest.mark.parametrize("make_column, reason", [
    (lambda: sa.Column("node_id", sa.String(64), unique=True), "unique"),
    (lambda: sa.Column("parent_id", sa.Integer, sa.ForeignKey("repos.id")), "foreign-key"),
])
def test_constrained_new_column_fails_loudly(tmp_path, make_column, reason):
    """UNIQUE 是 SQLite 的 ADD COLUMN 補不上；FOREIGN KEY 則是 SQLAlchemy 產的 DDL 不含
    REFERENCES。兩種放行的結果一樣：補成沒有約束的欄位。（非唯一索引不在此列——
    索引階段會用 CREATE INDEX IF NOT EXISTS 補上，見下面的測試。）

    先前會靜默補成沒有約束的欄位——新資料庫有 sqlite_autoindex、既有使用者沒有——
    而三份文件都宣稱會拋錯。實作要對得上文件，不然文件就是在說謊。
    """
    engine = _old_db(tmp_path / f"{reason}.db", {})
    column = make_column()
    md = _with_extra_columns("repos", column)

    with pytest.raises(SchemaNeedsMigration, match=f"repos.{column.name}"):
        ensure_columns(engine, metadata=md)

    assert column.name not in _columns(engine, "repos"), "拋錯前不得先加上沒有約束的欄位"


def test_column_added_by_another_process_meanwhile_is_tolerated(tmp_path):
    """App 與 launchd 收集器可能同時首次遇到新 schema。

    PRAGMA 之後、ALTER 之前被另一個行程搶先補上，SQLite 回 duplicate column name。
    這不是錯誤——欄位存在就是要的狀態，慢的那一方不該因此啟動失敗。
    """
    path = tmp_path / "race.db"
    # 兩個缺欄位：第一個被搶先，第二個必須仍補得上——釘住容忍錯誤之後連線池沒有壞掉
    engine = _old_db(path, {"repos": ["starred_at", "unstarred_at"]})
    other_process = sa.create_engine(f"sqlite:///{path}")
    raced: list[str] = []

    @sa.event.listens_for(engine, "before_cursor_execute")
    def _other_process_wins(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("ALTER TABLE") and not raced:
            raced.append(statement)
            with other_process.begin() as c2:
                c2.execute(sa.text(statement))

    ensure_columns(engine)  # 不該拋 duplicate column name

    assert len(raced) == 1, "前提：只有第一個 ALTER 被搶先"
    assert {"starred_at", "unstarred_at"} <= _columns(engine, "repos"), \
        "被搶先的那個要略過，下一個要照常補上"


def _index_column_sets(engine: sa.Engine, table: str) -> set[tuple[str, ...]]:
    with engine.connect() as conn:
        out = set()
        for row in conn.execute(sa.text(f"PRAGMA index_list({table})")):
            out.add(tuple(r[2] for r in conn.execute(sa.text(f"PRAGMA index_info({row[1]})"))))
        return out


def _index_names(engine: sa.Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        return {row[1] for row in conn.execute(sa.text(f"PRAGMA index_list({table})"))}


def test_indexed_new_column_gets_both_column_and_index(tmp_path):
    """index=True 的新欄位：欄位補上、索引也補上。先前一律 raise——開發者的空資料庫和 CI
    都正常，每個既有使用者卻會因為 SchemaNeedsMigration 起不來，而非唯一索引其實可以
    安全地補。"""
    engine = _old_db(tmp_path / "idx.db", {})
    md = _with_extra_columns("repos", sa.Column("lookup", sa.String(64), index=True))

    ensure_columns(engine, metadata=md)

    assert "lookup" in _columns(engine, "repos")
    assert ("lookup",) in _index_column_sets(engine, "repos")


def test_new_index_on_existing_column_is_created_and_idempotent(tmp_path):
    """model 對既有欄位新增 Index：對既有資料建非唯一索引不會失敗，補上即可。"""
    engine = _old_db(tmp_path / "idx2.db", {})
    md = sa.MetaData()
    table = Base.metadata.tables["repos"].to_metadata(md)
    sa.Index("ix_repos_language_new", table.c.language)

    ensure_columns(engine, metadata=md)
    assert ("language",) in _index_column_sets(engine, "repos")

    ensure_columns(engine, metadata=md)  # 重跑不該拋、也不該重複
    assert _index_count_for(engine, "repos", ("language",)) == 1


def test_existing_index_under_another_name_is_not_duplicated(tmp_path):
    """比對用欄位組合而不是名字：使用者資料庫裡同欄位若已有別名的索引，不重複建。"""
    engine = _old_db(tmp_path / "idx3.db", {})
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE INDEX manual_lang ON repos (language)"))
    md = sa.MetaData()
    table = Base.metadata.tables["repos"].to_metadata(md)
    sa.Index("ix_repos_language_new", table.c.language)

    ensure_columns(engine, metadata=md)

    names = _index_names(engine, "repos")
    assert "manual_lang" in names and "ix_repos_language_new" not in names


def test_unique_index_on_new_column_fails_loudly(tmp_path):
    """唯一索引可能撞既有重複值，不能自動補；新欄位帶唯一索引要當場拋錯。"""
    engine = _old_db(tmp_path / "uidx.db", {})
    md = sa.MetaData()
    table = Base.metadata.tables["repos"].to_metadata(md)
    table.append_column(sa.Column("node_id", sa.String(64)))
    sa.Index("uq_repos_node_id", table.c.node_id, unique=True)

    with pytest.raises(SchemaNeedsMigration, match="repos.node_id"):
        ensure_columns(engine, metadata=md)
    assert "node_id" not in _columns(engine, "repos")


def _index_count_for(engine: sa.Engine, table: str, cols: tuple[str, ...]) -> int:
    """同欄位組合的索引有幾個（list 計數，set 看不出重複）。"""
    with engine.connect() as conn:
        n = 0
        for row in conn.execute(sa.text(f"PRAGMA index_list({table})")):
            got = tuple(r[2] for r in conn.execute(sa.text(f'PRAGMA index_info("{row[1]}")')))
            n += got == cols
        return n


def _index_meta(engine: sa.Engine, table: str, name: str) -> tuple[tuple[str, ...], bool, bool]:
    """(欄位, unique, partial)"""
    with engine.connect() as conn:
        for row in conn.execute(sa.text(f"PRAGMA index_list({table})")):
            if row[1] == name:
                cols = tuple(r[2] for r in conn.execute(sa.text(f'PRAGMA index_info("{name}")')))
                return cols, bool(row[2]), bool(row[4])
    raise AssertionError(f"索引 {name} 不存在")


def _replace_index(engine: sa.Engine, ddl: str) -> None:
    with engine.begin() as conn:
        conn.execute(sa.text("DROP INDEX ix_repos_owner_name"))
        conn.execute(sa.text(ddl))


def test_same_name_index_on_other_columns_is_rebuilt(tmp_path):
    """資料庫裡有跟 model 同名、但欄位不同的索引：只靠 CREATE INDEX IF NOT EXISTS 會因為
    同名無聲跳過，還每次啟動記一條「已補上」的假成功，資料庫永遠對不齊（重審抓到的）。
    非唯一索引可以安全重建。"""
    engine = _old_db(tmp_path / "twin.db", {})
    _replace_index(engine, "CREATE INDEX ix_repos_owner_name ON repos (owner)")
    assert _index_meta(engine, "repos", "ix_repos_owner_name")[0] == ("owner",), "前提不成立"

    ensure_columns(engine)

    assert _index_meta(engine, "repos", "ix_repos_owner_name")[0] == ("owner", "name")
    assert _index_count_for(engine, "repos", ("owner", "name")) == 1
    assert _index_count_for(engine, "repos", ("owner",)) == 0, "錯的那個要被丟掉，不是留著並存"


def test_same_name_unique_twin_fails_loudly(tmp_path):
    """同名但資料庫側是唯一索引：拿掉唯一約束是 migration 的決定，啟動時不能默默做。"""
    engine = _old_db(tmp_path / "utwin.db", {})
    _replace_index(engine, "CREATE UNIQUE INDEX ix_repos_owner_name ON repos (owner, name)")

    with pytest.raises(SchemaNeedsMigration, match="ix_repos_owner_name"):
        ensure_columns(engine)

    assert _index_meta(engine, "repos", "ix_repos_owner_name")[1] is True, "拒絕時不得動它"


def test_partial_twin_is_rebuilt_as_full_index(tmp_path):
    """同名的 partial index 只涵蓋一部分列，不等於 model 要的完整索引，要重建。"""
    engine = _old_db(tmp_path / "ptwin.db", {})
    _replace_index(engine, "CREATE INDEX ix_repos_owner_name ON repos (owner, name) WHERE owner IS NOT NULL")
    assert _index_meta(engine, "repos", "ix_repos_owner_name")[2] is True, "前提不成立"

    ensure_columns(engine)

    cols, unique, partial = _index_meta(engine, "repos", "ix_repos_owner_name")
    assert (cols, unique, partial) == (("owner", "name"), False, False)


def test_index_name_needing_quotes_does_not_crash(tmp_path):
    """使用者資料庫裡的索引名若含空白或引號，未加引號的 PRAGMA index_info 會在啟動時炸。"""
    engine = _old_db(tmp_path / "quote.db", {})
    with engine.begin() as conn:
        conn.execute(sa.text('CREATE INDEX "my index" ON repos (language)'))

    ensure_columns(engine)  # 不該拋 OperationalError

    assert "my index" in _index_names(engine, "repos")

