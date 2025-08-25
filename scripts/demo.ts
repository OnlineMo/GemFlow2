/* eslint-disable no-console */
import path from "node:path";
import fsp from "node:fs/promises";
import { utcToZonedTime, format as formatDateTz } from "date-fns-tz";
import { runDaily, loadConfig } from "../src/app";

function todayStr(tz: string) {
  const zoned = utcToZonedTime(new Date(), tz);
  return formatDateTz(zoned, "yyyy-MM-dd", { timeZone: tz });
}

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

async function seedTrendsIfNeeded(aRoot: string, date: string) {
  const cacheDir = path.join(aRoot, "daily_trends");
  const cachePath = path.join(cacheDir, `${date}.json`);
  const force = process.env.DEMO_FORCE === "1";

  if (!force && (await fileExists(cachePath))) {
    console.info(`[demo] trends cache exists: ${cachePath}`);
    return;
  }

  await ensureDir(cacheDir);

  const demo = {
    date,
    source: "demo-seed",
    items: [
      { rank: 1, title: "AI 本地小模型优化", url: "https://www.baidu.com/s?wd=AI%20%E6%9C%AC%E5%9C%B0%E5%B0%8F%E6%A8%A1%E5%9E%8B%E4%BC%98%E5%8C%96", summary: "示例：本地端优化与推理性能", hotScore: 8888888, category: "realtime" },
      { rank: 2, title: "手机新品发布对行业影响", url: "https://www.baidu.com/s?wd=%E6%89%8B%E6%9C%BA%E6%96%B0%E5%93%81", summary: "示例：消费电子", hotScore: 6666666, category: "realtime" },
      { rank: 3, title: "云原生与 DevOps 安全趋势", url: "https://www.baidu.com/s?wd=%E4%BA%91%E5%8E%9F%E7%94%9F%20DevOps%20%E5%AE%89%E5%85%A8", summary: "示例：云与安全", hotScore: 5555555, category: "realtime" },
      { rank: 4, title: "数据中台与向量数据库实践", url: "https://www.baidu.com/s?wd=%E5%90%91%E9%87%8F%E6%95%B0%E6%8D%AE%E5%BA%93", summary: "示例：数据与数据库", hotScore: 4444444, category: "realtime" },
      { rank: 5, title: "产业并购与资本市场动向", url: "https://www.baidu.com/s?wd=%E4%BA%A7%E4%B8%9A%E5%B9%B6%E8%B4%AD", summary: "示例：经济与市场", hotScore: 3333333, category: "realtime" }
    ],
  };

  await fsp.writeFile(cachePath, JSON.stringify(demo, null, 2), "utf8");
  console.info(`[demo] trends seeded -> ${cachePath}`);
}

async function main() {
  const cfg = loadConfig();
  const tz = cfg.timezone || "Asia/Shanghai";
  const date = todayStr(tz);

  const cwd = process.cwd();
  const aRoot = path.resolve(cwd, "GemFlow2");
  console.info(`[demo] aRoot=${aRoot}`);

  // 1) 预置当日热榜缓存，避免联网依赖
  await seedTrendsIfNeeded(aRoot, date);

  // 2) 执行每日流程（将写入 DeepResearch-Archive/ 并更新导航与首页）
  await runDaily("daily");

  console.info(`[demo] done. 查看 DeepResearch-Archive/ 下的 AI_Reports/、NAVIGATION.md、README.md`);
}

main().catch((err) => {
  console.error("[demo] failed", err?.stack || err);
  process.exit(1);
});