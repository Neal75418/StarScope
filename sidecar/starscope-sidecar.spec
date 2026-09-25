# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for StarScope sidecar
# Build with: pyinstaller starscope-sidecar.spec

import os
import platform

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
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# 產物檔名要對上 Tauri 的 --target。CI 由 setup-sidecar action 以 STARSCOPE_TARGET_TRIPLE
# 明確指定：用執行中的架構去猜，猜錯時檔名對不上，Tauri 會安靜地改包 repo 裡的 placeholder。
# 本機直接跑 pyinstaller 時才退回用平台推斷
system = platform.system().lower()
if os.environ.get('STARSCOPE_TARGET_TRIPLE'):
    target_triple = os.environ['STARSCOPE_TARGET_TRIPLE']
elif system == 'darwin':
    target_triple = 'aarch64-apple-darwin' if platform.machine() == 'arm64' else 'x86_64-apple-darwin'
elif system == 'windows':
    target_triple = 'x86_64-pc-windows-msvc'
else:
    target_triple = 'x86_64-unknown-linux-gnu'

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name=f'starscope-sidecar-{target_triple}',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
