/**
 * 匯入儲存庫的解析與驗證工具。
 */

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
 * 驗證 GitHub owner 與 repo 名稱。
 * GitHub 使用者名稱/組織：1-39 字元，英數字或連字號，不可以連字號開頭。
 * Repo 名稱：類似但可包含點與底線。
 */
export function isValidGitHubIdentifier(str: string): boolean {
  const validPattern = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,38})?$/;
  return validPattern.test(str) && str.length > 0 && str.length <= 100;
}

/**
 * 解析 GitHub repo URL 或 owner/name 格式。
 */
export function parseRepoString(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 嘗試 URL 格式：https://github.com/owner/repo
  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/\s]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    const name = urlMatch[2].replace(/\.git$/, "");
    if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
      return { owner, name };
    }
    return null;
  }

  // 嘗試 owner/repo 格式
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
 * 從列表中移除重複的儲存庫（不分大小寫）。
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
 * 將 CSV 內容解析為儲存庫列表。
 */
export function parseCSV(content: string): ParsedRepo[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const repos: ParsedRepo[] = [];

  for (const line of lines) {
    // 跳過看起來像標題的列
    if (line.toLowerCase().includes("owner") && line.toLowerCase().includes("repo")) {
      continue;
    }

    // 嘗試解析為逗號分隔或單一 repo 字串
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));

    let parsed: { owner: string; name: string } | null = null;

    if (parts.length >= 2) {
      // 兩欄格式：owner, repo
      const owner = parts[0];
      const name = parts[1];
      if (isValidGitHubIdentifier(owner) && isValidGitHubIdentifier(name)) {
        parsed = { owner, name };
      }
    } else if (parts.length === 1) {
      // 單欄格式：owner/repo 或 URL
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
 * 將 JSON 內容解析為儲存庫列表。
 */
/**
 * 嘗試將單一 JSON 項目解析為 ParsedRepo。
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
 * 將 JSON 內容解析為儲存庫列表。
 */
export function parseJSON(content: string): ParsedRepo[] {
  try {
    const data: unknown = JSON.parse(content);
    const repos: ParsedRepo[] = [];

    // 處理字串陣列或物件陣列
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
 * 依副檔名或自動偵測格式來解析儲存庫內容。
 */
export function parseRepositories(content: string, filename?: string): ParsedRepo[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 依副檔名嘗試解析
  if (filename) {
    if (filename.endsWith(".json")) {
      return parseJSON(content);
    } else if (filename.endsWith(".csv") || filename.endsWith(".txt")) {
      return parseCSV(content);
    }
  }

  // 自動偵測格式
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJSON(content);
  } else {
    return parseCSV(content);
  }
}
