import fs from "node:fs";
import path from "node:path";

const CONVENTIONAL_HEADER = /^(feat|fix|chore|docs|style|refactor|perf|test)(\([^)]+\))?!?:\s*.+/gm;
const BREAKING = /BREAKING CHANGE:|breaking change:/gi;
const VERSION_HEADER = /^##\s+\[?([^\]]+)\]?|^#\s+(\d+\.\d+\.\d+)/m;

export interface ChangelogEntry {
  version?: string;
  content: string;
  isBreaking?: boolean;
  conventional?: string[];
}

export function extractChangelog(repoPath: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const changelogPath = path.join(repoPath, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return entries;

  try {
    const content = fs.readFileSync(changelogPath, "utf-8");
    const blocks = content.split(/(?=^##\s+\[?|^#\s+\d+\.\d+\.\d+)/m).filter((b) => b.trim());
    for (const block of blocks.slice(0, 20)) {
      const versionMatch = block.match(VERSION_HEADER);
      const version = versionMatch ? (versionMatch[1] || versionMatch[2]) : undefined;
      const isBreaking = BREAKING.test(block);
      const conventional = [...block.matchAll(CONVENTIONAL_HEADER)].map((m) => m[0]);
      entries.push({
        version,
        content: block.slice(0, 1500),
        isBreaking,
        conventional: conventional.length ? conventional : undefined,
      });
    }
  } catch {
    /* ignore */
  }
  return entries;
}
