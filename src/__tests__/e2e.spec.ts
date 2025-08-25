import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";

import { runDaily, loadConfig } from "../app";

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function fileExists(p: string) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string) {
  return await fsp.readFile(p, "utf8");
}

function todayStr(tz: string) {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

let tmpRepoB: string;
let aRoot: string;
let date: string;

beforeAll(async () => {
  const cfg = loadConfig();
  const tz = cfg.timezone || "Asia/Shanghai";
  process.env.TZ = tz;

  // 临时库B目录
  tmpRepoB = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-e2e-repoB-"));
  process.env.REPO_B_DIR = tmpRepoB;

  // A 根目录（注意 app.ts 内使用 ROOT/GemFlow2）
  const cwd = process.cwd();
  aRoot = path.resolve(cwd, "GemFlow2");
  await ensureDir(aRoot);

  // 预置当日热榜缓存，避免联网依赖
  date = todayStr(tz);
  const cacheDir = path.join(aRoot, "daily_trends");
  const cachePath = path.join(cacheDir, `${date}.json`);
  await ensureDir(cacheDir);
  const demo = {
    date,
    source: "e2e-seed",
    items: [
      { rank: 1, title: "AI 本地小模型优化", url: "https://www.baidu.com/s?wd=AI%20%E6%9C%AC%E5%9C%B0", summary: "示例", hotScore: 8888888, category: "realtime" },
      { rank: 2, title: "云原生与 DevOps 趋势", url: "https://www.baidu.com/s?wd=DevOps", summary: "示例", hotScore: 6666666, category: "realtime" },
      { rank: 3, title: "产业并购与资本动向", url: "https://www.baidu.com/s?wd=%E5%B9%B6%E8%B4%AD", summary: "示例", hotScore: 3333333, category: "realtime" }
    ],
  };
  await fsp.writeFile(cachePath, JSON.stringify(demo, null, 2), "utf8");
});

afterAll(async () => {
  // 清理临时库B
  await fsp.rm(tmpRepoB, { recursive: true, force: true }).catch(() => {});
});

describe("e2e: runDaily with seeded cache", () => {
  it("generates at least one report and updates NAVIGATION.md and README.md", async () => {
    // 执行完整流程（daily）
    await runDaily("daily");

    // 校验库B结构
    const navPath = path.join(tmpRepoB, "NAVIGATION.md");
    const readmePath = path.join(tmpRepoB, "README.md");
    const reportsDir = path.join(tmpRepoB, "AI_Reports");

    expect(await fileExists(navPath)).toBe(true);
    expect(await fileExists(readmePath)).toBe(true);
    expect(await fileExists(reportsDir)).toBe(true);

    const nav = await readText(navPath);
    expect(nav).toMatch(/DeepResearch 报告导航/);

    const readme = await readText(readmePath);
    // README 日期占位被替换为当日
    expect(readme).toMatch(new RegExp(`日期 Date: <!-- DATE -->${date}<!-- \\/DATE -->`));

    // 至少生成一篇报告（在任意分类目录下）
    // 粗略扫描一层分类目录
    const categories = await fsp.readdir(reportsDir);
    let anyReport = false;
    for (const cat of categories) {
      const catDir = path.join(reportsDir, cat);
      const stat = await fsp.stat(catDir);
      if (!stat.isDirectory()) continue;
      const files = await fsp.readdir(catDir);
      if (files.some((f: string) => f.endsWith(".md"))) {
        anyReport = true;
        break;
      }
    }
    expect(anyReport).toBe(true);
  });
});