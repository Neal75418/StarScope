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
export function isValidGitHubIdentifier(str: string): boolean {
  const validPattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,38})?$/;
  return validPattern.test(str) && str.length > 0 && str.length <= 100;
}

/**
 * Parse a GitHub repo URL or owner/name format.
 */
export function parseRepoString(input: string): { owner: string; name: string } | null {
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
export function removeDuplicates(repos: ParsedRepo[]): ParsedRepo[] {
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
export function parseCSV(content: string): ParsedRepo[] {
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
/**
 * Try to parse a single JSON item into a ParsedRepo.
 */
function parseRepoItem(item: unknown): { owner: string; name: string } | null {
  if (typeof item === "string") {
    return parseRepoString(item);
  } else if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;

    if (typeof obj.owner === "string" && typeof obj.name === "string") {
      const owner = obj.owner;
      const name = obj.name;
      if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
        return { owner, name };
      }
    } else if (typeof obj.full_name === "string") {
      return parseRepoString(obj.full_name);
    } else if (typeof obj.fullName === "string") {
      return parseRepoString(obj.fullName);
    } else if (typeof obj.url === "string") {
      return parseRepoString(obj.url);
    }
  }
  return null;
}

/**
 * Parse JSON content into repo list.
 */
export function parseJSON(content: string): ParsedRepo[] {
  try {
    const data: unknown = JSON.parse(content);
    const repos: ParsedRepo[] = [];

    // Handle array of strings or objects
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      const parsed = parseRepoItem(item);

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

/**
 * Parse repository content based on file extension or auto-detection.
 */
export function parseRepositories(content: string, filename?: string): ParsedRepo[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Try based on extension
  if (filename) {
    if (filename.endsWith(".json")) {
      return parseJSON(content);
    } else if (filename.endsWith(".csv") || filename.endsWith(".txt")) {
      return parseCSV(content);
    }
  }

  // Auto-detect format
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJSON(content);
  } else {
    return parseCSV(content);
  }
}
