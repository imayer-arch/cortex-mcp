import fs from "node:fs";
import path from "node:path";

const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/gi;
const ALTER_TABLE = /ALTER\s+TABLE\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?/gi;

export interface TableInfo {
  tableName: string;
  schema?: string;
  filePath: string;
  operation: "CREATE" | "ALTER";
}

export function extractTablesFromSqlRepo(repoPath: string, workspaceRoot: string): TableInfo[] {
  const tables: TableInfo[] = [];
  const seen = new Set<string>();

  function scan(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        scan(full);
        continue;
      }
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".sql")) continue;
      try {
        const content = fs.readFileSync(full, "utf-8");
        const relPath = path.relative(workspaceRoot, full).replace(/\\/g, "/");

        let m: RegExpExecArray | null;
        const createRegex = new RegExp(CREATE_TABLE.source, "gi");
        while ((m = createRegex.exec(content)) !== null) {
          const schema = m[1] || undefined;
          const table = m[2];
          const key = `${schema || "public"}.${table}`;
          if (!seen.has(key)) {
            seen.add(key);
            tables.push({ tableName: table, schema, filePath: relPath, operation: "CREATE" });
          }
        }
        const alterRegex = new RegExp(ALTER_TABLE.source, "gi");
        while ((m = alterRegex.exec(content)) !== null) {
          const schema = m[1] || undefined;
          const table = m[2];
          const key = `alter:${schema || "public"}.${table}`;
          if (!seen.has(key)) {
            seen.add(key);
            tables.push({ tableName: table, schema, filePath: relPath, operation: "ALTER" });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  scan(repoPath);
  return tables;
}
