/**
 * Hook for managing repository import functionality.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { addRepo, getRepos, RepoWithSignals } from "../api/client";

export interface ParsedRepo {
  owner: string;
  name: string;
  fullName: string;
  status: "pending" | "importing" | "success" | "error" | "skipped";
  error?: string;
}

export interface ImportResult {
  total: number;
  success: number;
  skipped: number;
  failed: number;
}

/**
 * Validate GitHub owner and repo name.
 * GitHub usernames/orgs: 1-39 chars, alphanumeric or hyphens, can't start with hyphen.
 * Repo names: similar but can have dots and underscores.
 */
function isValidGitHubIdentifier(str: string): boolean {
  const validPattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,38})?$/;
  return validPattern.test(str) && str.length > 0 && str.length <= 100;
}

/**
 * Parse a GitHub repo URL or owner/name format.
 */
function parseRepoString(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try URL format: https://github.com/owner/repo
  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/\s]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    const name = urlMatch[2].replace(/\.git$/, "");
    if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
      return { owner, name };
    }
    return null;
  }

  // Try owner/repo format
  const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) {
    const owner = slashMatch[1];
    const name = slashMatch[2];
    if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
      return { owner, name };
    }
  }

  return null;
}

/**
 * Remove duplicate repos from the list (case-insensitive).
 */
function removeDuplicates(repos: ParsedRepo[]): ParsedRepo[] {
  const seen = new Set<string>();
  return repos.filter((r) => {
    const key = r.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse CSV content into repo list.
 */
function parseCSV(content: string): ParsedRepo[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const repos: ParsedRepo[] = [];

  for (const line of lines) {
    // Skip header row if it looks like a header
    if (line.toLowerCase().includes("owner") && line.toLowerCase().includes("repo")) {
      continue;
    }

    // Try to parse as comma-separated or just a repo string
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));

    let parsed: { owner: string; name: string } | null = null;

    if (parts.length >= 2) {
      // Two columns: owner, repo
      const owner = parts[0];
      const name = parts[1];
      if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
        parsed = { owner, name };
      }
    } else if (parts.length === 1) {
      // Single column: owner/repo or URL
      parsed = parseRepoString(parts[0]);
    }

    if (parsed) {
      repos.push({
        owner: parsed.owner,
        name: parsed.name,
        fullName: `${parsed.owner}/${parsed.name}`,
        status: "pending",
      });
    }
  }

  return repos;
}

/**
 * Parse JSON content into repo list.
 */
function parseJSON(content: string): ParsedRepo[] {
  try {
    const data = JSON.parse(content);
    const repos: ParsedRepo[] = [];

    // Handle array of strings or objects
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      let parsed: { owner: string; name: string } | null = null;

      if (typeof item === "string") {
        parsed = parseRepoString(item);
      } else if (typeof item === "object" && item !== null) {
        if (item.owner && item.name) {
          const owner = String(item.owner);
          const name = String(item.name);
          if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
            parsed = { owner, name };
          }
        } else if (item.full_name) {
          parsed = parseRepoString(String(item.full_name));
        } else if (item.fullName) {
          parsed = parseRepoString(String(item.fullName));
        } else if (item.url) {
          parsed = parseRepoString(String(item.url));
        }
      }

      if (parsed) {
        repos.push({
          owner: parsed.owner,
          name: parsed.name,
          fullName: `${parsed.owner}/${parsed.name}`,
          status: "pending",
        });
      }
    }

    return repos;
  } catch {
    return [];
  }
}

export function useImport() {
  const [parsedRepos, setParsedRepos] = useState<ParsedRepo[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const parseFile = useCallback(async (file: File) => {
    setParseError(null);
    setResult(null);
    setParsedRepos([]);

    try {
      const content = await file.text();
      let repos: ParsedRepo[];

      if (file.name.endsWith(".json")) {
        repos = parseJSON(content);
      } else if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        repos = parseCSV(content);
      } else {
        // Try to auto-detect format
        const trimmed = content.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
          repos = parseJSON(content);
        } else {
          repos = parseCSV(content);
        }
      }

      if (repos.length === 0) {
        setParseError("No valid repositories found in file");
        return;
      }

      setParsedRepos(removeDuplicates(repos));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse file");
    }
  }, []);

  const parseText = useCallback((text: string) => {
    setParseError(null);
    setResult(null);
    setParsedRepos([]);

    const trimmed = text.trim();
    if (!trimmed) {
      setParseError("Please enter repository names");
      return;
    }

    let repos: ParsedRepo[];

    // Try JSON first
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      repos = parseJSON(trimmed);
    } else {
      repos = parseCSV(trimmed);
    }

    if (repos.length === 0) {
      setParseError("No valid repositories found");
      return;
    }

    setParsedRepos(removeDuplicates(repos));
  }, []);

  const startImport = useCallback(async () => {
    if (parsedRepos.length === 0 || isImporting) return;

    // Cancel any previous import
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsImporting(true);
    setResult(null);

    // Get existing repos to check for duplicates
    let existingRepos: RepoWithSignals[] = [];
    try {
      const response = await getRepos();
      existingRepos = response.repos;
    } catch {
      // Continue even if we can't get existing repos
    }

    const existingSet = new Set(existingRepos.map((r) => r.full_name.toLowerCase()));

    let success = 0;
    let skipped = 0;
    let failed = 0;

    // Create a snapshot of repos to process
    const reposToProcess = [...parsedRepos];

    // Helper to update a specific repo by fullName
    const updateRepo = (fullName: string, updates: Partial<ParsedRepo>) => {
      setParsedRepos((prev) =>
        prev.map((r) => (r.fullName === fullName ? { ...r, ...updates } : r))
      );
    };

    for (const repo of reposToProcess) {
      // Check if cancelled
      if (abortController.signal.aborted) {
        break;
      }

      // Check if already exists
      if (existingSet.has(repo.fullName.toLowerCase())) {
        updateRepo(repo.fullName, { status: "skipped" });
        skipped++;
        continue;
      }

      // Mark as importing
      updateRepo(repo.fullName, { status: "importing" });

      // Retry logic with exponential backoff
      let lastError: string = "Failed";
      let imported = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (abortController.signal.aborted) break;

        try {
          await addRepo({ owner: repo.owner, name: repo.name });
          updateRepo(repo.fullName, { status: "success" });
          existingSet.add(repo.fullName.toLowerCase());
          success++;
          imported = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : "Failed";

          // Check if it's a rate limit error (contains "rate" or status 429)
          const isRateLimit =
            lastError.toLowerCase().includes("rate") ||
            lastError.includes("429");

          if (isRateLimit && attempt < 2) {
            // Exponential backoff: 2s, 4s
            const delay = Math.pow(2, attempt + 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // For other errors or final attempt, don't retry
          break;
        }
      }

      if (!imported && !abortController.signal.aborted) {
        updateRepo(repo.fullName, { status: "error", error: lastError });
        failed++;
      }

      // Small delay between requests to avoid rate limiting
      if (!abortController.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (!abortController.signal.aborted) {
      setResult({
        total: reposToProcess.length,
        success,
        skipped,
        failed,
      });
      setIsImporting(false);
    }

    abortControllerRef.current = null;
  }, [parsedRepos, isImporting]);

  const reset = useCallback(() => {
    // Cancel any ongoing import
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setParsedRepos([]);
    setResult(null);
    setParseError(null);
    setIsImporting(false);
  }, []);

  return {
    parsedRepos,
    isImporting,
    result,
    parseError,
    parseFile,
    parseText,
    startImport,
    reset,
  };
}
