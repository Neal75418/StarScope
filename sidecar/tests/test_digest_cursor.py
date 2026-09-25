"""摘要游標：存在 app settings，只進不退，壞掉時當作第一次使用。"""

from db.models import AppSetting, AppSettingKey
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
