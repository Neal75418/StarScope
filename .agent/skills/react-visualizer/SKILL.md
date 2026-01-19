---
name: react-visualizer
description: Expert guidance on React 19 Dashboard and Recharts
---

# React Visualizer Guide

本專案前端負責資料呈現。

## 1. Data Visualization (Recharts)

- **Performance**:
  - 繪製大量數據點 (GitHub Stars History) 時，使用 `recharts` 的 `allowDataOverflow` 與 `Brush` 元件來縮放。
  - 不要一次 render 幾千個點，先在 Python 端做 Downsampling (降採樣) 再傳給前端。

- **Themes**:
  - 圖表顏色需適配 Dark/Light Mode。使用 CSS Variables 定義圖表色票。

## 2. State Management

- **SWR / TanStack Query**:
  - 強烈建議使用 `SWR` 或 `React Query` 來管理對 Python API 的請求。
  - 利用其 Polling 機制 (`refreshInterval`) 來實作準即時的 Dashboard 更新。

## 3. Platform Integration

- **Link Opening**:
  - 在 Tauri 中，`<a>` 標籤預設可能不會開啟系統瀏覽器。
  - 使用 `@tauri-apps/plugin-opener` 的 `open()` 方法來處理外部連結。
