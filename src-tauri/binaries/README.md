# Sidecar Binaries

This directory contains the compiled Python sidecar binaries for each platform.

## Building the Sidecar

From the `sidecar/` directory:

```bash
# Install PyInstaller
pip install pyinstaller

# Build for current platform
pyinstaller starscope-sidecar.spec

# Copy to binaries directory
# macOS ARM64:
cp dist/starscope-sidecar-aarch64-apple-darwin ../src-tauri/binaries/

# macOS Intel:
cp dist/starscope-sidecar-x86_64-apple-darwin ../src-tauri/binaries/

# Windows:
cp dist/starscope-sidecar-x86_64-pc-windows-msvc.exe ../src-tauri/binaries/

# Linux:
cp dist/starscope-sidecar-x86_64-unknown-linux-gnu ../src-tauri/binaries/
```

## Required Files

Tauri expects binaries named with the target triple suffix:
- `starscope-sidecar-aarch64-apple-darwin` (macOS ARM64)
- `starscope-sidecar-x86_64-apple-darwin` (macOS Intel)
- `starscope-sidecar-x86_64-pc-windows-msvc.exe` (Windows)
- `starscope-sidecar-x86_64-unknown-linux-gnu` (Linux)
