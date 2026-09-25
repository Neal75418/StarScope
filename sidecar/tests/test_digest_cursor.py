"""摘要游標：存在 app settings，只進不退，壞掉時當作第一次使用。"""

import threading

from sqlalchemy.orm import sessionmaker

from db.database import create_app_engine
from db.models import AppSetting, AppSettingKey, Base
from services.digest import DigestCursor, clear_cursor, load_cursor, save_cursor


def test_no_cursor_means_first_visit(test_db):
    assert load_cursor(test_db) == (None, None)


def test_save_then_load_round_trips_and_records_when(test_db):
    save_cursor(DigestCursor(10, 3, 1), test_db)

    cursor, seen_at = load_cursor(test_db)

    assert cursor == DigestCursor(10, 3, 1)
    assert seen_at is not None


def test_cursor_never_moves_backwards(test_db):
    save_cursor(DigestCursor(10, 3, 1), test_db)

    written = save_cursor(DigestCursor(8, 5, 0), test_db)

    # 逐欄取 max：重送一個舊的 cursor 不能讓看過的東西再出現
    assert written == DigestCursor(10, 5, 1)
    assert load_cursor(test_db)[0] == DigestCursor(10, 5, 1)


def test_corrupt_cursor_is_treated_as_first_visit(test_db):
    test_db.add(AppSetting(key=AppSettingKey.DIGEST_CURSOR, value="{not json"))
    test_db.commit()

    assert load_cursor(test_db) == (None, None)


def test_cursor_missing_a_field_is_treated_as_first_visit(test_db):
    test_db.add(AppSetting(key=AppSettingKey.DIGEST_CURSOR, value='{"context_signal_id": 1}'))
    test_db.commit()

    assert load_cursor(test_db) == (None, None)


def test_clear_cursor(test_db):
    save_cursor(DigestCursor(1, 1, 1), test_db)

    clear_cursor(test_db)

    assert load_cursor(test_db) == (None, None)


def test_concurrent_saves_do_not_lose_the_larger_cursor(tmp_path, monkeypatch):
    # 兩支 POST 在 threadpool 裡並行：沒有互斥的話兩邊讀到同一個舊值，後寫的蓋掉先寫的
    # （游標倒退），第一次寫入時則是其中一個撞 UNIQUE 回 500
    import services.digest as digest_module

    engine = create_app_engine(f"sqlite:///{tmp_path / 'cursor.db'}")
    Base.metadata.create_all(bind=engine)
    session_local = sessionmaker(bind=engine)
    real_load = digest_module.load_cursor
    both_loaded = threading.Barrier(2, timeout=0.5)

    def load_then_wait(db):
        result = real_load(db)
        try:
            both_loaded.wait()
        except threading.BrokenBarrierError:
            pass  # 有互斥時另一個執行緒進不來，等不到是正常的
        return result

    monkeypatch.setattr(digest_module, "load_cursor", load_then_wait)
    errors: list[Exception] = []

    def save(cursor):
        with session_local() as db:
            try:
                save_cursor(cursor, db)
            except Exception as exc:  # noqa: BLE001 — 要把例外帶回主執行緒斷言
                errors.append(exc)

    threads = [threading.Thread(target=save, args=(DigestCursor(9, 0, 0),)),
               threading.Thread(target=save, args=(DigestCursor(5, 0, 0),))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    monkeypatch.undo()

    assert errors == []
    with session_local() as db:
        assert load_cursor(db)[0] == DigestCursor(9, 0, 0)
    engine.dispose()
