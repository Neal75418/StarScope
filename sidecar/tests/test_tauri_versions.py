"""tauri 的 Rust crate 與對應的 npm 套件要在同一個 major.minor。

`tauri build` 會比對 Cargo.lock 的 crate 與 package.json 直接依賴的 npm 套件（tauri ↔ @tauri-apps/api、
tauri-plugin-X ↔ @tauri-apps/plugin-X），major 或 minor 不同就直接失敗（tauri-cli 的 info/plugins.rs
check_mismatched_packages；`tauri dev` 只印錯誤不擋）。CI 平常不跑 `tauri build`，對不上要等發版預演或打 tag 才知道：
npm 與 cargo 分開升級時最容易發生。這裡比 tauri-cli 嚴，例如：npm 裝了 plugin、Rust 卻沒有對應的 crate 也算錯。
"""

import json
import re
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TAURI_NPM = re.compile(r"@tauri-apps/(api|plugin-[\w-]+)")
TILDE = re.compile(r"~(\d+)\.(\d+)(?:\.\d+)?")


def _major_minor(version: str) -> tuple[int, int]:
    major, minor = version.split(".")[:2]
    return int(major), int(minor)


def _package_lock() -> dict:
    lock: dict = json.loads((REPO / "package-lock.json").read_text(encoding="utf-8"))
    return lock


def _npm_tauri_packages() -> dict[str, str]:
    """package.json 直接依賴的 @tauri-apps/api 與 @tauri-apps/plugin-*：名稱 → package-lock 鎖的版本。"""
    manifest = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    direct = {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}
    installed = _package_lock()["packages"]
    return {name: installed[f"node_modules/{name}"]["version"] for name in direct if TAURI_NPM.fullmatch(name)}


def _cargo_lock_versions() -> dict[str, list[str]]:
    lock = tomllib.loads((REPO / "src-tauri" / "Cargo.lock").read_text(encoding="utf-8"))
    versions: dict[str, list[str]] = {}
    for package in lock["package"]:
        versions.setdefault(package["name"], []).append(package["version"])
    return versions


def _crate_for(npm_name: str) -> str:
    return "tauri" if npm_name == "@tauri-apps/api" else "tauri-" + npm_name.removeprefix("@tauri-apps/")


def test_there_are_tauri_packages_to_compare():
    assert "@tauri-apps/api" in _npm_tauri_packages()


def test_installed_crates_and_npm_packages_share_major_and_minor():
    crates = _cargo_lock_versions()
    mismatched, unregistered = [], []
    for npm_name, npm_version in sorted(_npm_tauri_packages().items()):
        crate = _crate_for(npm_name)
        if crate not in crates:
            unregistered.append(f"{npm_name} {npm_version}（Cargo.lock 沒有 {crate}）")
        for crate_version in crates.get(crate, []):
            if _major_minor(crate_version) != _major_minor(npm_version):
                mismatched.append(f"{crate} {crate_version} ↔ {npm_name} {npm_version}")
    assert not mismatched, "tauri build 會因為版本對不上而失敗，兩邊要一起升：\n" + "\n".join(mismatched)
    assert not unregistered, "npm 裝了 plugin、Rust 卻沒有對應的 crate（前端呼叫會找不到指令）：\n" + "\n".join(unregistered)


def test_there_is_only_one_tauri_api_in_node_modules():
    """plugin 要求更新的 @tauri-apps/api 時，npm 會在它底下另裝一份：tauri-cli 與上面的比對都只看最上層那份。"""
    nested = sorted(
        path for path in _package_lock()["packages"]
        if path.endswith("/node_modules/@tauri-apps/api") and path.count("node_modules/") > 1
    )
    assert not nested, f"@tauri-apps/api 有不只一份，要對齊成一份（升最上層那份時，Cargo.toml 的 tauri 也要一起升）：{nested}"


def test_the_tauri_crate_is_held_to_the_same_minor_as_the_npm_api():
    """Cargo.toml 只寫 "2" 的話，cargo update 會悄悄把 tauri 升到下一個 minor，npm 那邊卻還是 ~2.12。"""
    cargo = tomllib.loads((REPO / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8"))
    tauri = cargo["dependencies"]["tauri"]
    crate_range = tauri["version"] if isinstance(tauri, dict) else tauri
    npm_range = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["dependencies"]["@tauri-apps/api"]

    crate_minor = TILDE.fullmatch(crate_range)
    npm_minor = TILDE.fullmatch(npm_range)
    assert crate_minor, f"Cargo.toml 的 tauri 要用 ~ 鎖在一個 minor（~2.12 或 ~2.12.3），現在是 {crate_range!r}"
    assert npm_minor, f"package.json 的 @tauri-apps/api 要用 ~ 鎖在一個 minor，現在是 {npm_range!r}"
    assert crate_minor.groups() == npm_minor.groups(), f"tauri {crate_range} 與 @tauri-apps/api {npm_range} 不在同一個 minor"
