import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadStore() {
  const dist = path.join(__dirname, "..", "dist", "memory", "store.js");
  if (!fs.existsSync(dist)) {
    console.warn("Skip store tests: run npm run build first");
    return null;
  }
  return await import(pathToFileURL(dist).href);
}

describe("store", () => {
  it("searchMemory returns empty when memory empty", async () => {
    const mod = await loadStore();
    if (!mod) return;
    mod.clearMemory();
    const results = mod.searchMemory("pagos", 5);
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it("searchMemory returns matching entries by term", async () => {
    const mod = await loadStore();
    if (!mod) return;
    mod.clearMemory();
    mod.setMemory([
      {
        id: "a:readme",
        kind: "readme",
        source: "bff-moor",
        sourcePath: "README.md",
        title: "BFF Moor",
        content: "Backend para pagos y origination.",
        tags: [],
        references: [],
      },
    ]);
    const results = mod.searchMemory("pagos", 5);
    assert.ok(results.length >= 1);
    assert.ok(results[0].content.toLowerCase().includes("pagos"));
  });

  it("searchMemoryByEmbedding returns empty when no embeddings", async () => {
    const mod = await loadStore();
    if (!mod) return;
    mod.clearMemory();
    mod.setMemory([
      {
        id: "a:readme",
        kind: "readme",
        source: "bff",
        sourcePath: "README.md",
        title: "BFF",
        content: "Content",
        tags: [],
        references: [],
      },
    ]);
    const fakeEmbedding = [0.1, 0.2, 0.3];
    const results = mod.searchMemoryByEmbedding(fakeEmbedding, 5);
    assert.strictEqual(results.length, 0);
  });
});
