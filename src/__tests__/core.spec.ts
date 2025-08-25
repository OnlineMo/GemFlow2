import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";

import { loadConfig, _internal } from "../app";

let tmpRoot: string;
let repoB: string;

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-test-"));
  repoB = path.join(tmpRoot, "DeepResearch-Archive");
  await fsp.mkdir(repoB, { recursive: true });
});

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("config and classify", () => {
  it("loadConfig returns sane defaults", () => {
    const cfg = loadConfig();
    expect(typeof cfg.timezone).toBe("string");
    expect(cfg.timezone.length).toBeGreaterThan(0);
    expect(cfg.maxTopics).toBeGreaterThanOrEqual(1);
  });

  it("classifyTopic heuristics identifies LLM", async () => {
    const cfg = loadConfig();
    const topic = { title: "大模型突破带来新机会", reason: "t", edition: "v1" };
    const res = await _internal.classifyTopic(topic as any, cfg);
    expect(res.categorySlug).toBe("llm");
    expect(res.confidence).toBeGreaterThan(0);
  });
});

describe("report generation and repoB writes", () => {
  it("generateReport &#45;> writeReportIfChanged is idempotent and updates nav/readme", async () => {
    const cfg = loadConfig();
    const date = "2025-01-01";
    // Minimal trends and topic
    const trends = { date, source: "unit-test", items: [] };
    const classified = {
      title: "AI 本地小模型优化",
      reason: "unit",
      edition: "v1",
      categorySlug: "llm",
      categoryDisplay: "大语言模型",
      confidence: 0.9,
      sourceUrl: "https://www.baidu.com/s?wd=AI",
    };

    const { markdown, meta } = await _internal.generateReport(classified as any, trends as any, cfg, "test-run-1");
    const first = await _internal.writeReportIfChanged(repoB, meta, markdown);
    expect(first.changed).toBe(true);

    const second = await _internal.writeReportIfChanged(repoB, meta, markdown);
    expect(second.changed).toBe(false);

    await _internal.updateNavigation(repoB);
    const navPath = path.join(repoB, "NAVIGATION.md");
    const nav = await fsp.readFile(navPath, "utf8");
    expect(nav).toMatch(/DeepResearch 报告导航/);
    expect(nav).toMatch(/大语言模型/);
    expect(nav).toMatch(/AI 本地小模型优化/);

    await _internal.updateReadmeToday(repoB, date, 20);
    const readmePath = path.join(repoB, "README.md");
    const readme = await fsp.readFile(readmePath, "utf8");
    expect(readme).toMatch(/日期 Date: <!-- DATE -->2025-01-01<!-- \/DATE -->/);
    expect(readme).toMatch(/AI 本地小模型优化/);
  });
});

describe("candidate extraction fallback", () => {
  it("extractCandidatesViaGemini falls back to heuristics without API key", async () => {
    const cfg = loadConfig();
    const trends = {
      date: "2025-01-02",
      source: "unit-test",
      items: Array.from({ length: 10 }).map((_, i) => ({
        rank: i + 1,
        title: i === 1 ? "AI 模型进展" : i === 2 ? "手机新品发布" : `测试主题${i}`,
      })),
    };
    const cands = await _internal.extractCandidatesViaGemini(trends as any, cfg);
    expect(Array.isArray(cands)).toBe(true);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.length).toBeLessThanOrEqual(cfg.maxTopics);
    expect(cands[0]).toHaveProperty("edition");
  });
});