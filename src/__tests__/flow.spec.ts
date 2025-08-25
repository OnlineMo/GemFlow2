import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { runDaily, loadConfig, _internal } from "../app";

const {
  fetchTrendsCached,
  classifyTopic,
  updateNavigation,
  updateReadmeToday,
} = _internal as any;

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

describe("flow: modes and cached trends", () => {
  let tmpRepoB: string;
  let aRoot: string;

  beforeAll(async () => {
    // 独立库B目录，避免污染本地
    tmpRepoB = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-flow-repoB-"));
    process.env.REPO_B_DIR = tmpRepoB;

    // A 根目录（与 app.ts 逻辑保持一致）
    const cwd = process.cwd();
    aRoot = path.resolve(cwd, "GemFlow2");
    await ensureDir(aRoot);
  });

  it("runDaily supports 'nav' and 'readme' modes", async () => {
    await runDaily("nav");
    await runDaily("readme");

    const navPath = path.join(tmpRepoB, "NAVIGATION.md");
    const readmePath = path.join(tmpRepoB, "README.md");
    expect(await exists(navPath)).toBe(true);
    expect(await exists(readmePath)).toBe(true);
  });

  it("fetchTrendsCached uses fresh cache for arbitrary date", async () => {
    const cfg = loadConfig();
    const date = "2099-01-01";
    const cacheDir = path.join(aRoot, "daily_trends");
    const cachePath = path.join(cacheDir, `${date}.json`);
    await ensureDir(cacheDir);

    const demo = {
      date,
      source: "test-cache",
      items: [
        { rank: 1, title: "AI 本地小模型优化", url: "https://www.baidu.com/s?wd=AI", hotScore: 999999 },
        { rank: 2, title: "云原生与 DevOps", url: "https://www.baidu.com/s?wd=DevOps", hotScore: 888888 },
      ],
    };
    await fsp.writeFile(cachePath, JSON.stringify(demo, null, 2), "utf8");

    const got = await fetchTrendsCached(date, cfg);
    expect(got.date).toBe(date);
    expect(got.items.length).toBeGreaterThan(0);
  });
});

describe("classifyTopic heuristics covers multiple categories", () => {
  const cfg = loadConfig();

  const cases: Array<{ title: string; expectSlug: string }> = [
    { title: "大模型推理优化", expectSlug: "llm" },
    { title: "网络安全漏洞爆发", expectSlug: "cybersecurity" },
    { title: "手机新品发布会", expectSlug: "consumer-tech" },
    { title: "云原生与 DevOps 趋势", expectSlug: "cloud-devops" },
    { title: "数据库与数仓技术盘点", expectSlug: "data" },
    { title: "Web 前端性能优化", expectSlug: "web-mobile" },
    { title: "软件工程最佳实践", expectSlug: "software-dev" },
    { title: "区块链应用进展", expectSlug: "blockchain" },
    { title: "科学探索与太空任务", expectSlug: "science" },
    { title: "医疗健康与药物研发", expectSlug: "healthcare" },
    { title: "新能源与减排政策", expectSlug: "energy-climate" },
    { title: "经济与市场动态", expectSlug: "economy" },
    { title: "行业并购与公司财报", expectSlug: "industry" },
    { title: "监管政策与合规更新", expectSlug: "policy" },
    { title: "文化媒体与社交热点", expectSlug: "culture-media" },
  ];

  it("maps titles to expected category slugs", async () => {
    for (const c of cases) {
      const res = await classifyTopic({ title: c.title, reason: "t", edition: "v1" }, cfg);
      expect(res.categorySlug).toBe(c.expectSlug);
      expect(res.confidence).toBeGreaterThan(0);
    }
  });
});

describe("nav/readme builders on empty repoB", () => {
  it("generate scaffold files even when no reports exist", async () => {
    const tmpRepoB = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-empty-repoB-"));
    await updateNavigation(tmpRepoB);
    await updateReadmeToday(tmpRepoB, "2025-01-01", 20);

    const navPath = path.join(tmpRepoB, "NAVIGATION.md");
    const readmePath = path.join(tmpRepoB, "README.md");
    const nav = await fsp.readFile(navPath, "utf8");
    const readme = await fsp.readFile(readmePath, "utf8");
    expect(nav).toMatch(/NAV:START/);
    expect(readme).toMatch(/TODAY_REPORTS:START/);
  });
});

async function exists(p: string) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}