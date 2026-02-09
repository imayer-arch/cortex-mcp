import fs from "node:fs";
import path from "node:path";
import type { DiscoveredRepo } from "./discovery.js";
import type { RouteInfo } from "./routes.js";

function findGoFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "vendor" && !e.name.startsWith(".")) {
      results.push(...findGoFiles(full));
    } else if (e.isFile() && e.name.endsWith(".go")) results.push(full);
  }
  return results;
}

/** Chi: r.Get("/path", handler), r.Post(...), r.Route("/prefix", func(r chi.Router) { r.Get(...) }) */
const CHI_METHOD_PATH = /\.(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*["`']([^"`']+)["`']/g;
/** Echo: e.GET("/path", handler), e.POST(...) */
const ECHO_METHOD_PATH = /\.(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(\s*["`']([^"`']+)["`']/g;
/** Gin: r.GET("/path", handler) */
const GIN_METHOD_PATH = /\.(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(\s*["`']([^"`']+)["`']/g;
/** gorilla/mux: r.HandleFunc("/path", handler).Methods("GET") or .Methods("GET","POST") */
const GORILLA_HANDLE = /\.HandleFunc\s*\(\s*["`']([^"`']+)["`']/g;
const GORILLA_METHODS = /\.Methods\s*\(\s*["`']([^"`']+)["`'](?:\s*,\s*["`']([^"`']+)["`'])*\s*\)/g;
/** net/http simple: mux.Handle("/path", ...) or http.HandleFunc("/path", ...) */
const HANDLE_PATH = /(?:HandleFunc|Handle)\s*\(\s*["`']([^"`']+)["`']/g;

function extractRoutesFromContent(
  content: string,
  filePath: string,
  workspaceRoot: string,
  basePath: string
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");

  function add(method: string, fullPath: string, line?: number) {
    const p = fullPath.trim().replace(/^\/+/, "").replace(/\/+/g, "/");
    if (!p || p.length > 400) return;
    routes.push({
      method: method.toUpperCase(),
      fullPath: "/" + p,
      filePath: relPath,
      line,
      requestBodyType: undefined,
      responseType: undefined,
      handlerName: undefined,
    });
  }

  // Chi / Echo / Gin style: .Get("/path", ...)
  const chiLike = [...content.matchAll(CHI_METHOD_PATH)];
  for (const m of chiLike) {
    const line = content.slice(0, m.index).split("\n").length;
    const pathPart = (m[2] || "").trim();
    const full = basePath ? basePath.replace(/\/+$/, "") + "/" + pathPart.replace(/^\/+/, "") : pathPart;
    add(m[1], full, line);
  }

  const echoLike = [...content.matchAll(ECHO_METHOD_PATH)];
  for (const m of echoLike) {
    const line = content.slice(0, m.index).split("\n").length;
    const pathPart = (m[2] || "").trim();
    const full = basePath ? basePath.replace(/\/+$/, "") + "/" + pathPart.replace(/^\/+/, "") : pathPart;
    add(m[1], full, line);
  }

  const ginLike = [...content.matchAll(GIN_METHOD_PATH)];
  for (const m of ginLike) {
    const line = content.slice(0, m.index).split("\n").length;
    const pathPart = (m[2] || "").trim();
    const full = basePath ? basePath.replace(/\/+$/, "") + "/" + pathPart.replace(/^\/+/, "") : pathPart;
    add(m[1], full, line);
  }

  // gorilla/mux: path then .Methods("GET") - associate by proximity (same line block)
  const handleMatches = [...content.matchAll(GORILLA_HANDLE)];
  const methodMatches = [...content.matchAll(GORILLA_METHODS)];
  for (let i = 0; i < handleMatches.length; i++) {
    const pathPart = (handleMatches[i][1] || "").trim().replace(/^\/+/, "");
    const full = basePath ? basePath.replace(/\/+$/, "") + "/" + pathPart : pathPart;
    const line = content.slice(0, handleMatches[i].index).split("\n").length;
    if (i < methodMatches.length) {
      const methodsStr = methodMatches[i][0];
      const single = methodMatches[i][1];
      const rest = [...methodMatches[i].slice(2)].filter(Boolean);
      const methods = [single, ...rest].map((s) => s?.replace(/"/g, "").trim()).filter(Boolean);
      for (const method of methods) add(method, full, line);
    } else {
      add("GET", full, line);
    }
  }

  // HandleFunc/Handle without .Methods
  for (const m of content.matchAll(HANDLE_PATH)) {
    const pathPart = (m[1] || "").trim().replace(/^\/+/, "");
    if (!pathPart) continue;
    const full = basePath ? basePath.replace(/\/+$/, "") + "/" + pathPart : pathPart;
    const line = content.slice(0, m.index).split("\n").length;
    add("GET", full, line);
  }

  return routes;
}

export function extractGoRoutes(repo: DiscoveredRepo, workspaceRoot: string): RouteInfo[] {
  const allRoutes: RouteInfo[] = [];
  const searchDirs = [
    repo.absolutePath,
    path.join(repo.absolutePath, "cmd"),
    path.join(repo.absolutePath, "internal"),
    path.join(repo.absolutePath, "pkg"),
    path.join(repo.absolutePath, "api"),
  ];
  const seen = new Set<string>();

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const files = findGoFiles(dir);
    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      if (!content.includes("HandleFunc") && !content.includes(".Get(") && !content.includes(".GET(") && !content.includes("Handle(")) continue;
      const basePath = "";
      const routes = extractRoutesFromContent(content, filePath, workspaceRoot, basePath);
      for (const r of routes) {
        const key = r.method + ":" + r.fullPath;
        if (seen.has(key)) continue;
        seen.add(key);
        allRoutes.push(r);
      }
    }
  }

  return allRoutes;
}
