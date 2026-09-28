# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for StarScope sidecar
# Build with: pyinstaller starscope-sidecar.spec

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Uvicorn
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # SQLAlchemy
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.sql.default_comparator',
        # FastAPI / Pydantic
        'pydantic',
        'pydantic.deprecated.decorator',
        # Tenacity
        'tenacity',
        # httpx
        'httpx',
        'httpcore',
        # App modules
        'routers',
        'services',
        'db',
        'schemas',
        'utils',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # PyInstaller 的 pydantic hook 會收進 pydantic 所有子模組，包括給 mypy 用的外掛（pydantic.mypy、
    # pydantic.v1.mypy），連帶把整個 mypy 和它的原生擴充（librt、ast_serialize）打包進出貨的 sidecar。
    # 執行期沒有任何程式碼 import 它們：開發工具不該跟著 app 出貨，也不該多一個要簽章的原生 binary
    excludes=["mypy", "pydantic.mypy", "pydantic.v1.mypy", "librt", "ast_serialize"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# onedir：執行檔加上 _internal/。onefile 每次啟動都要把整包解壓到暫存目錄（實測 8–10 秒），
# onedir 直接載入（約 1 秒）。整個資料夾由 scripts/stage_sidecar.py 放進 src-tauri/sidecar/，
# 作為 Tauri 的 resources 打包（externalBin 只能放單一執行檔）。架構不寫在檔名上：
# scripts/check_sidecar_binary.py 讀執行檔的檔頭來檢查
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='starscope-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX 壓過的 macOS dylib 簽章會失效
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='starscope-sidecar',
)
