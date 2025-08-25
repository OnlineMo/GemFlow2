import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { _internal } from "../app";

const {
  updateNavigation,
  updateReadmeToday,
  scanReports,
  renderNavigation,
  displayNameForCategory,
} = _internal as any;

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function writeText(p: string, s: string) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, s, "utf8");
}

describe("coverage-extra: cover branches in nav/readme and scanReports", () => {
  it("replaces existing NAVIGATION.md region when markers exist", async () => {
    const repo = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-cov-nav-"));
    const navPath = path.join(repo, "NAVIGATION.md");

    const old = [
      "# Old Title",
      "",
      "说明：此处内容会被自动替换。",
      "",
      "<!-- NAV:START version=0 -->",
      "旧内容 - 不应保留",
      "<!-- NAV:END -->",
      "",
      "_footer remains_",
    ].join("\n");
    await writeText(navPath, old);

    await updateNavigation(repo);
    const now = await fsp.readFile(navPath, "utf8");

    expect(now).toMatch(/DeepResearch 报告导航/);
    expect(now).toMatch(/<!-- NAV:START/);
    expect(now).toMatch(/<!-- NAV:END -->/);
    // 保留 footer
    expect(now).toMatch(/_footer remains_/);
  });

  it("updates existing README.md markers and handles '暂无数据' branch", async () => {
    const repo = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-cov-readme-"));
    const readmePath = path.join(repo, "README.md");
    const seed = [
      "# DeepResearch — Today's Reports",
      "",
      "日期 Date: <!-- DATE -->2000-01-01<!-- /DATE -->",
      "",
      "## 今日报告 Today",
      "",
      "<!-- TODAY_REPORTS:START max=20 -->",
      "- 旧占位",
      "<!-- TODAY_REPORTS:END -->",
      "",
    ].join("\n");
    await writeText(readmePath, seed);

    // 指定未来日期，且 repo 中没有任何报告，期望生成“暂无数据”
    await updateReadmeToday(repo, "2099-12-31", 20);
    const now = await fsp.readFile(readmePath, "utf8");
    expect(now).toMatch(/日期 Date: <!-- DATE -->2099-12-31<!-- \/DATE -->/);
    expect(now).toMatch(/<!-- TODAY_REPORTS:START/);
    expect(now).toMatch(/- 暂无数据/);
  });

  it("scanReports parses filename fallback (no front matter) and renderNavigation works", async () => {
    const repo = await fsp.mkdtemp(path.join(os.tmpdir(), "gemflow2-cov-scan-"));
    const catDir = path.join(repo, "AI_Reports", "uncategorized");
    await ensureDir(catDir);

    // 没有 front matter，仅文件名携带日期/版次
    const reportPath = path.join(catDir, "测试主题A-2099-01-01--v1.md");
    await writeText(reportPath, "正文内容\n");

    const items = await scanReports(repo);
    expect(items.length).toBeGreaterThan(0);
    const first = items[0];
    expect(first.date).toBe("2099-01-01");
    expect(first.edition).toBe("v1");
    expect(first.categorySlug).toBe("uncategorized");

    const nav = renderNavigation(items);
    expect(typeof nav).toBe("string");
    expect(nav).toMatch(/uncategorized/);
  });

  it("displayNameForCategory returns mapping or falls back to slug", () => {
    expect(displayNameForCategory("llm")).toBeTruthy();
    expect(displayNameForCategory("non-existent-slug")).toBe("non-existent-slug");
  });
});