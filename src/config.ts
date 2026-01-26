/**
 * Application configuration
 * Centralized config to avoid hardcoded values across the codebase
 */

// API Configuration
// Can be overridden via environment variable (VITE_API_URL) for development/testing
const DEFAULT_API_PORT = 8008;
const DEFAULT_API_HOST = "127.0.0.1";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`;
export const API_PREFIX = "/api";

// Full API endpoint
export const API_ENDPOINT = `${API_BASE_URL}${API_PREFIX}`;
