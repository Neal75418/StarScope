import { describe, it, expect } from "vitest";
import {
  isValidGitHubIdentifier,
  parseRepoString,
  removeDuplicates,
  parseCSV,
  parseJSON,
  parseRepositories,
  ParsedRepo,
} from "../importHelpers";

describe("importHelpers", () => {
  describe("isValidGitHubIdentifier", () => {
    it("accepts valid identifiers", () => {
      expect(isValidGitHubIdentifier("facebook")).toBe(true);
      expect(isValidGitHubIdentifier("react")).toBe(true);
      expect(isValidGitHubIdentifier("my-repo")).toBe(true);
      expect(isValidGitHubIdentifier("my.repo")).toBe(true);
      expect(isValidGitHubIdentifier("my_repo")).toBe(true);
      expect(isValidGitHubIdentifier("a")).toBe(true);
    });

    it("rejects invalid identifiers", () => {
      expect(isValidGitHubIdentifier("")).toBe(false);
      expect(isValidGitHubIdentifier("-starts-with-hyphen")).toBe(false);
      expect(isValidGitHubIdentifier(".starts-with-dot")).toBe(false);
      expect(isValidGitHubIdentifier("a".repeat(101))).toBe(false);
    });
  });

  describe("parseRepoString", () => {
    it("parses owner/name format", () => {
      expect(parseRepoString("facebook/react")).toEqual({ owner: "facebook", name: "react" });
    });

    it("parses GitHub URL format", () => {
      expect(parseRepoString("https://github.com/facebook/react")).toEqual({
        owner: "facebook",
        name: "react",
      });
    });

    it("handles .git suffix in URL", () => {
      expect(parseRepoString("https://github.com/facebook/react.git")).toEqual({
        owner: "facebook",
        name: "react",
      });
    });

    it("returns null for invalid input", () => {
      expect(parseRepoString("")).toBeNull();
      expect(parseRepoString("just-a-name")).toBeNull();
      expect(parseRepoString("  ")).toBeNull();
    });

    it("trims whitespace", () => {
      expect(parseRepoString("  facebook/react  ")).toEqual({
        owner: "facebook",
        name: "react",
      });
    });

    it("returns null for invalid owner/name characters", () => {
      expect(parseRepoString("-invalid/react")).toBeNull();
    });
  });

  describe("removeDuplicates", () => {
    it("removes duplicate repos (case insensitive)", () => {
      const repos: ParsedRepo[] = [
        { owner: "facebook", name: "react", fullName: "facebook/react", status: "pending" },
        { owner: "Facebook", name: "React", fullName: "Facebook/React", status: "pending" },
        { owner: "vuejs", name: "vue", fullName: "vuejs/vue", status: "pending" },
      ];

      const result = removeDuplicates(repos);

      expect(result).toHaveLength(2);
      expect(result[0].fullName).toBe("facebook/react");
      expect(result[1].fullName).toBe("vuejs/vue");
    });
  });

  describe("parseCSV", () => {
    it("parses two-column CSV (owner, repo)", () => {
      const csv = "facebook,react\nvuejs,vue";
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0].fullName).toBe("facebook/react");
      expect(result[1].fullName).toBe("vuejs/vue");
    });

    it("parses single-column CSV (owner/repo)", () => {
      const csv = "facebook/react\nvuejs/vue";
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
    });

    it("skips header rows", () => {
      const csv = "owner,repo\nfacebook,react";
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0].fullName).toBe("facebook/react");
    });

    it("handles quoted values", () => {
      const csv = '"facebook","react"';
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0].fullName).toBe("facebook/react");
    });

    it("skips blank lines", () => {
      const csv = "facebook/react\n\nvuejs/vue\n";
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
    });

    it("parses URLs in CSV", () => {
      const csv = "https://github.com/facebook/react";
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0].fullName).toBe("facebook/react");
    });
  });

  describe("parseJSON", () => {
    it("parses array of strings", () => {
      const json = JSON.stringify(["facebook/react", "vuejs/vue"]);
      const result = parseJSON(json);

      expect(result).toHaveLength(2);
      expect(result[0].fullName).toBe("facebook/react");
    });

    it("parses array of objects with owner/name", () => {
      const json = JSON.stringify([
        { owner: "facebook", name: "react" },
        { owner: "vuejs", name: "vue" },
      ]);
      const result = parseJSON(json);

      expect(result).toHaveLength(2);
    });

    it("parses objects with full_name", () => {
      const json = JSON.stringify([{ full_name: "facebook/react" }]);
      const result = parseJSON(json);

      expect(result).toHaveLength(1);
      expect(result[0].fullName).toBe("facebook/react");
    });

    it("parses objects with fullName (camelCase)", () => {
      const json = JSON.stringify([{ fullName: "facebook/react" }]);
      const result = parseJSON(json);

      expect(result).toHaveLength(1);
    });

    it("parses objects with url", () => {
      const json = JSON.stringify([{ url: "https://github.com/facebook/react" }]);
      const result = parseJSON(json);

      expect(result).toHaveLength(1);
    });

    it("returns empty for invalid JSON", () => {
      expect(parseJSON("not json")).toEqual([]);
    });

    it("handles single object (not array)", () => {
      const json = JSON.stringify({ owner: "facebook", name: "react" });
      const result = parseJSON(json);

      expect(result).toHaveLength(1);
    });
  });

  describe("parseRepositories", () => {
    it("auto-detects JSON format", () => {
      const content = JSON.stringify(["facebook/react"]);
      const result = parseRepositories(content);

      expect(result).toHaveLength(1);
    });

    it("auto-detects CSV format", () => {
      const content = "facebook/react\nvuejs/vue";
      const result = parseRepositories(content);

      expect(result).toHaveLength(2);
    });

    it("uses filename extension for .json", () => {
      const content = JSON.stringify(["facebook/react"]);
      const result = parseRepositories(content, "repos.json");

      expect(result).toHaveLength(1);
    });

    it("uses filename extension for .csv", () => {
      const content = "facebook,react";
      const result = parseRepositories(content, "repos.csv");

      expect(result).toHaveLength(1);
    });

    it("returns empty for empty content", () => {
      expect(parseRepositories("")).toEqual([]);
      expect(parseRepositories("  ")).toEqual([]);
    });
  });
});
