import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadPersistence() {
  const dist = path.join(__dirname, "..", "dist", "memory", "persistence.js");
  if (!fs.existsSync(dist)) {
    console.warn("Skip persistence tests: run npm run build first");
    return null;
  }
  return await import(pathToFileURL(dist).href);
}

describe("persistence", () => {
  it("loadFromDisk returns null when cache dir does not exist", async () => {
    const mod = await loadPersistence();
    if (!mod) return;
    const orig = process.env.WORKSPACE_ROOT;
    const empty = path.join(os.tmpdir(), "cortex-empty-root-" + Date.now());
    fs.mkdirSync(empty, { recursive: true });
    process.env.WORKSPACE_ROOT = empty;
    try {
      const loaded = mod.loadFromDisk();
      assert.strictEqual(loaded, null);
    } finally {
      if (orig !== undefined) process.env.WORKSPACE_ROOT = orig;
      else delete process.env.WORKSPACE_ROOT;
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("saveToDisk and loadFromDisk roundtrip", async () => {
    const mod = await loadPersistence();
    if (!mod) return;
    const root = path.join(os.tmpdir(), "cortex-persist-" + Date.now());
    fs.mkdirSync(root, { recursive: true });
    const orig = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = root;
    const entries = [
      {
        id: "test:README.md",
        kind: "readme",
        source: "test",
        sourcePath: "README.md",
        title: "Test",
        content: "Hello",
        tags: [],
        references: [],
      },
    ];
    const repoMTimes = { "test-repo": Date.now() };
    try {
      mod.saveToDisk(entries, repoMTimes);
      const loaded = mod.loadFromDisk();
      assert.ok(loaded !== null);
      assert.ok(Array.isArray(loaded.entries));
      assert.strictEqual(loaded.entries.length, 1);
      assert.strictEqual(loaded.entries[0].id, "test:README.md");
      assert.strictEqual(loaded.repoMTimes["test-repo"], repoMTimes["test-repo"]);
    } finally {
      if (orig !== undefined) process.env.WORKSPACE_ROOT = orig;
      else delete process.env.WORKSPACE_ROOT;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
