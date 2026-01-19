---
name: tauri-master
description: Expert guidance on Tauri v2, Sidecars, and Rust Interop
---

# Tauri v2 Expert Guide

本專案 (`StarScope`) 使用 Tauri v2 架構，整合 Rust 原生層與 Python Sidecar。

## 1. Sidecar Management

- **Lifecycle**:
  - Python Sidecar 應由 Tauri 主進程 (Rust) 啟動與監控。
  - 使用 `tauri::plugin::shell` 來 spawn Python process。
  - 當 App 關閉 (`WindowEvent::CloseRequested`) 時，務必確保 Python process 也被殺死 (Graceful Shutdown)。

## 2. IPC Patterns

- **Rust <-> Frontend**:
  - 使用 `#[tauri::command]` 處理系統級操作 (Tray, Notifications, Window Control)。
  - 不要用 Rust 做複雜的資料處理，那是 Python 的工作。

- **Frontend <-> Python**:
  - 前端直接透過 HTTP (`fetch('http://localhost:8008/...')`) 與 Python Sidecar 通訊，取得分析數據。
  - 這樣可以減少序列化開銷 (Python -> Rust -> WebView)，直接 Python -> WebView。

## 3. System Tray

- **Native Experience**:
  - 確保點擊 Tray Icon 可以 Toggle 視窗顯示/隱藏。
  - 在 Tray Menu 中提供 "Quit" 選項來完全終止程式 (含 Sidecar)。
