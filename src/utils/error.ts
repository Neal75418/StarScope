/**
 * Centralized error handling utilities for consistent error messages.
 */

import { ApiError } from "../api/client";

/**
 * Extract a user-friendly error message from any error.
 *
 * @param error - The caught error (can be ApiError, Error, or unknown)
 * @param fallbackMessage - Default message if error details are unavailable
 * @returns A user-friendly error message
 */
export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.detail || fallbackMessage;
  }

  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}

/**
 * Check if an error is a network error (no connection to API).
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 0;
  }
  return false;
}

/**
 * Check if an error is a not found error (404).
 */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 404;
  }
  return false;
}

/**
 * Check if an error is a validation error (400/422).
 */
export function isValidationError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 400 || error.status === 422;
  }
  return false;
}

/**
 * Check if an error is an authentication error (401).
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 401;
  }
  return false;
}

/**
 * Check if an error is a rate limit error (429).
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 429;
  }
  return false;
}

/**
 * Check if an error is a server error (5xx).
 */
export function isServerError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  return false;
}
