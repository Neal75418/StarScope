"""資料目錄：開發模式、安裝版、collector 必須是同一個，安裝版才看得到 collector 寫的資料。"""

from db.database import get_app_data_dir


def test_uses_the_explicit_override(monkeypatch, tmp_path):
    monkeypatch.setenv("STARSCOPE_DATA_DIR", str(tmp_path / "custom"))
    monkeypatch.setenv("TAURI_APP_DATA_DIR", str(tmp_path / "app-support"))

    assert get_app_data_dir() == tmp_path / "custom"


def test_the_installed_app_uses_the_same_folder_as_dev_mode(monkeypatch, tmp_path):
    # 舊版 Rust 會傳 TAURI_APP_DATA_DIR（Application Support），安裝版因此看不到 collector 的資料：
    # 就算有人把它加回去，也不能採用
    monkeypatch.delenv("STARSCOPE_DATA_DIR", raising=False)
    monkeypatch.setenv("TAURI_APP_DATA_DIR", str(tmp_path / "app-support"))
    monkeypatch.setenv("HOME", str(tmp_path))  # 家目錄：Unix 看 HOME，Windows 看 USERPROFILE
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    assert get_app_data_dir() == tmp_path / ".starscope"
