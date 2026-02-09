import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamic import of built code (run after npm run build)
async function loadDiscovery() {
  const dist = path.join(__dirname, "..", "dist", "code", "discovery.js");
  if (!fs.existsSync(dist)) {
    console.warn("Skip discovery tests: run npm run build first");
    return null;
  }
  const mod = await import(pathToFileURL(dist).href);
  return mod;
}

describe("discovery", () => {
  it("detectGo returns true for dir with go.mod", async () => {
    const mod = await loadDiscovery();
    if (!mod) return;
    const tmp = path.join(os.tmpdir(), "cortex-test-go-mod");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "go.mod"), "module example.com/test\n");
    try {
      assert.strictEqual(mod.detectGo(tmp), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detectGo returns false for empty dir", async () => {
    const mod = await loadDiscovery();
    if (!mod) return;
    const tmp = path.join(os.tmpdir(), "cortex-test-empty-" + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    try {
      assert.strictEqual(mod.detectGo(tmp), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("discoverRepos returns repos with type go when go.mod present", async () => {
    const mod = await loadDiscovery();
    if (!mod) return;
    const root = path.join(os.tmpdir(), "cortex-discover-" + Date.now());
    fs.mkdirSync(root, { recursive: true });
    const goRepo = path.join(root, "my-go-service");
    fs.mkdirSync(goRepo, { recursive: true });
    fs.writeFileSync(path.join(goRepo, "go.mod"), "module my-go-service\n");
    try {
      const repos = mod.discoverRepos(root);
      const goRepos = repos.filter((r) => r.type === "go");
      assert.ok(goRepos.length >= 1, "expected at least one go repo");
      assert.ok(goRepos.some((r) => r.id === "my-go-service"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
