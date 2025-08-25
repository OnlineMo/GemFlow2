import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";

import { loadConfig, _internal } from "../app";

const {
  buildFrontMatter,
  buildReportMarkdown,
  filePathForReport,
  toSlug,
  safeFileName,
  sha256,
  makeId,
  updateNavigation,
  updateReadmeToday,
  writeReportIfChanged,
} = _internal as any;

let tmpRepoB: string;

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

beforeAll(async () => {
  tmpRepoB = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-unit-repoB-"));
  await ensureDir(tmpRepoB);
});

describe("naming and hashing utils", () => {
  it("toSlug should fallback to 'untitled' for non-latin-only strings", () => {
    const s = toSlug("中文 标题");
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
  });

  it("safeFileName should remove illegal characters", () => {
    const name = safeFileName('a<b>:"/\\|?*  name');
    expect(name.includes("<")).toBe(false);
    expect(name.includes(">")).toBe(false);
    expect(name.includes(":")).toBe(false);
    expect(name.trim().length).toBeGreaterThan(0);
  });

  it("sha256 and makeId should be stable", () => {
    const h1 = sha256("abc");
    const h2 = sha256("abc");
    expect(h1).toBe(h2);

    const id1 = makeId("Topic", "2025-01-01", "v1");
    const id2 = makeId("  topic  ", "2025-01-01", "v1"); // normalization
    expect(id1).toBe(id2);
  });
});

describe("front matter and report markdown", () => {
  it("buildFrontMatter and buildReportMarkdown produce expected sections", () => {
    const meta = {
      title: "AI 本地小模型优化",
      date: "2025-01-01",
      edition: "v1",
      categorySlug: "llm",
      categoryDisplay: "大语言模型",
      source: "unit-test",
      slug: "ai-local-llm",
      runId: "run_xxx",
    };
    const md = buildReportMarkdown(meta, {
      summary: ["要点1", "要点2"],
      background: ["背景1"],
      analysis: ["分析1"],
      refs: [{ name: "来源", url: "https://example.com" }],
      conclusions: ["结论1"],
    });
    expect(md.startsWith("---")).toBe(true);
    expect(md).toMatch(/title:\s*AI 本地小模型优化/);
    expect(md).toMatch(/# 摘要/);
    expect(md).toMatch(/# 深度分析/);
    expect(md).toMatch(/# 数据与引用/);
  });

  it("filePathForReport composes correct relative path", () => {
    const meta = {
      title: "AI 本地小模型优化",
      date: "2025-01-01",
      edition: "v1",
      categorySlug: "llm",
      categoryDisplay: "大语言模型",
      source: "unit-test",
      slug: "ai-local-llm",
      runId: "run_xxx",
    };
    const { rel } = filePathForReport(tmpRepoB, meta);
    expect(rel.replace(/\\/g, "/")).toMatch(/^AI_Reports\/llm\/.*2025-01-01--v1\.md$/);
  });
});

describe("navigation and readme builders", () => {
  it("updateNavigation renders grouped categories and updateReadmeToday updates date section", async () => {
    const cfg = loadConfig();
    // Write two reports in different categories
    const meta1 = {
      title: "AI 本地小模型优化",
      date: "2025-01-02",
      edition: "v1",
      categorySlug: "llm",
      categoryDisplay: "大语言模型",
      source: "unit-test",
      slug: "ai-local-llm",
      runId: "run1",
    };
    const meta2 = {
      title: "软件工程最佳实践",
      date: "2025-01-02",
      edition: "v1",
      categorySlug: "software-dev",
      categoryDisplay: "软件开发与工程",
      source: "unit-test",
      slug: "software-dev",
      runId: "run1",
    };

    const md1 = buildReportMarkdown(meta1, { summary: ["s1"], background: [], analysis: [], refs: [], conclusions: [] });
    const md2 = buildReportMarkdown(meta2, { summary: ["s1"], background: [], analysis: [], refs: [], conclusions: [] });
    await writeReportIfChanged(tmpRepoB, meta1, md1);
    await writeReportIfChanged(tmpRepoB, meta2, md2);

    await updateNavigation(tmpRepoB);
    const navPath = path.join(tmpRepoB, "NAVIGATION.md");
    const navText = await fsp.readFile(navPath, "utf8");
    expect(navText).toMatch(/DeepResearch 报告导航/);
    expect(navText).toMatch(/大语言模型/);
    expect(navText).toMatch(/软件开发与工程/);

    // Readme update for a target date
    await updateReadmeToday(tmpRepoB, "2025-01-02", cfg.todayMaxOnReadme);
    const readmePath = path.join(tmpRepoB, "README.md");
    const readme = await fsp.readFile(readmePath, "utf8");
    expect(readme).toMatch(/日期 Date: <!-- DATE -->2025-01-02<!-- \/DATE -->/);
    expect(readme).toMatch(/AI 本地小模型优化/);
  });
});