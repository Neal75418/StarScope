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
