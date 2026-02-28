/**
 * 應用程式設定。
 * 集中管理以避免散落在各處的硬編碼值。
 */

// API 設定
// 可透過環境變數（VITE_API_URL）覆寫，用於開發/測試
const DEFAULT_API_PORT = 8008;
const DEFAULT_API_HOST = "127.0.0.1";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`;
const API_PREFIX = "/api";

// 完整 API endpoint
export const API_ENDPOINT = `${API_BASE_URL}${API_PREFIX}`;
