/* eslint-disable no-console */
/**
 * GemFlow2 Orchestrator - 单文件最小可运行端到端实现
 * 目标：在不依赖外部资料的前提下，完成库A端到端最小闭环：
 *  - 抓取百度热榜（多源聚合 + 直抓回退 + 本地缓存）
 *  - 主题提取与分类（Gemini 可选；无 Key 时用启发式）
 *  - 生成 Markdown 报告（带 front matter）
 *  - 写入库B DeepResearch-Archive/ 并幂等更新导航与 README
 *  - 历史与指纹去重
 *
 * 后续建议将本文件拆分为模块：config、logger、storage、datasource、topic、graph、report、repob、nav、readme、history 等。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";


import { fetch } from "undici";
import * as cheerio from "cheerio";
import YAML from "yaml";
import fg from "fast-glob";
/** timezone formatting via Intl.DateTimeFormat (no date-fns-tz runtime) */
import slugify from "slugify";
import pLimit from "p-limit";
import pRetry from "p-retry";
import dotenv from "dotenv";

// 可选：Gemini（无 Key 则不使用）
/* c8 ignore start - optional runtime import */
let GoogleGenerativeAI: any = null;
try {
  // 动态 require 以避免离线或未安装时报错
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  GoogleGenerativeAI = require("@google/generative-ai").GoogleGenerativeAI;
} catch {
  GoogleGenerativeAI = null;
}
/* c8 ignore stop */

dotenv.config();

/* ===========================
   类型定义
=========================== */

export interface Config {
  geminiApiKey?: string;
  model: string;
  temperature: number;
  rpm?: number;
  tpm?: number;
  concurrent: number;
  perStepMs: number;
  totalMs: number;
  retryMax: number;
  retryInitialMs: number;
  retryFactor: number;
  repoBDir: string;
  timezone: string;
  cacheTtlMs: number;
  dryRun: boolean;
  maxTopics: number;
  todayMaxOnReadme: number;
  tianApiKey?: string;
}

export interface TrendItem {
  rank: number;
  title: string;
  url?: string;
  summary?: string;
  hotScore?: number;
  category?: string;
}

export interface TrendsDay {
  date: string; // YYYY-MM-DD
  source: string; // 数据来源
  items: TrendItem[];
}

export interface CandidateTopic {
  title: string;
  reason: string;
  edition: string; // v1 v2...
  sourceUrl?: string;
}

export interface ClassifiedTopic extends CandidateTopic {
  categorySlug: string; // ai-ml llm software-dev ...
  categoryDisplay: string; // AI 与机器学习 等
  confidence: number; // 0..1
}

export interface ReportMeta {
  title: string;
  date: string; // YYYY-MM-DD
  edition: string;
  slug: string;
  categorySlug: string;
  categoryDisplay: string;
  source: string;
  runId: string;
}

export interface HistoryRecord {
  id: string; // sha256(normalizedTitle + date + edition)
  title: string;
  date: string;
  edition: string;
  categorySlug: string;
  slug: string;
  path: string; // 相对 repoB 根的路径
  source: string;
  runId: string;
  status: "pending" | "ok" | "failed";
  error?: string;
  updatedAt: string; // ISO
}

/* ===========================
   常量与工具
=========================== */

const ROOT = safeResolve(process.cwd());
const A_ROOT = safeResolve(path.join(ROOT, "GemFlow2")); // 当前库A根（尽量相对）
const B_ROOT_DEFAULT = safeResolve(path.join(ROOT, "DeepResearch-Archive")); // 库B根

function ensureDirSync(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}
async function ensureDir(dir: string) {
  ensureDirSync(dir);
}
function safeResolve(p: string) {
  return path.resolve(p);
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function normalizeTitleForHash(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function toSlug(input: string) {
  // 用 slugify 生成 URL-safe；中文会被移除或转写，作为内部 ID 可接受
  return slugify(input, { lower: true, strict: true, replacement: "-" }) || "untitled";
}

function safeFileName(input: string) {
  // 保留中文，替换非法字符
  const replaced = input.replace(/[\\/:*?"<>|\r\n]+/g, "-").replace(/\s+/g, " ").trim();
  return replaced || "未命名";
}

function nowIso() {
  return new Date().toISOString();
}

function todayStr(tz: string) {
  // Use Intl to format YYYY-MM-DD in a specific timezone without external deps
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

/* ===========================
   配置加载
=========================== */
export function loadConfig(): Config {
  const tz = process.env.TZ || "Asia/Shanghai";
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-pro",
    temperature: process.env.GEMINI_TEMPERATURE ? Number(process.env.GEMINI_TEMPERATURE) : 0.3,
    rpm: process.env.RATE_LIMIT_RPM ? Number(process.env.RATE_LIMIT_RPM) : 300,
    tpm: process.env.RATE_LIMIT_TPM ? Number(process.env.RATE_LIMIT_TPM) : 80000,
    concurrent: process.env.RATE_LIMIT_CONCURRENT ? Number(process.env.RATE_LIMIT_CONCURRENT) : 4,
    perStepMs: process.env.TIMEOUT_PER_STEP_MS ? Number(process.env.TIMEOUT_PER_STEP_MS) : 30_000,
    totalMs: process.env.TIMEOUT_TOTAL_MS ? Number(process.env.TIMEOUT_TOTAL_MS) : 120_000,
    retryMax: process.env.RETRY_MAX ? Number(process.env.RETRY_MAX) : 3,
    retryInitialMs: process.env.RETRY_INITIAL_MS ? Number(process.env.RETRY_INITIAL_MS) : 500,
    retryFactor: process.env.RETRY_FACTOR ? Number(process.env.RETRY_FACTOR) : 2,
    repoBDir: process.env.REPO_B_DIR ? safeResolve(process.env.REPO_B_DIR) : B_ROOT_DEFAULT,
    timezone: tz,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    dryRun: process.env.DRY_RUN === "true",
    maxTopics: process.env.MAX_TOPICS ? Number(process.env.MAX_TOPICS) : 5,
    todayMaxOnReadme: process.env.README_TODAY_MAX ? Number(process.env.README_TODAY_MAX) : 20,
    tianApiKey: process.env.TIANAPI_KEY,
  };
}

/* ===========================
   日志与事件（简化版）
=========================== */
function logInfo(msg: string, extra?: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "INFO", ts: nowIso(), msg, ...(extra || {}) }));
}
function logWarn(msg: string, extra?: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: "WARN", ts: nowIso(), msg, ...(extra || {}) }));
}
function logError(msg: string, extra?: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "ERROR", ts: nowIso(), msg, ...(extra || {}) }));
}

/* ===========================
   文件读写工具
=========================== */
async function readJson<T>(p: string, def: T): Promise<T> {
  try {
    const s = await fsp.readFile(p, "utf8");
    return JSON.parse(s) as T;
  } catch {
    return def;
  }
}
async function writeJson(p: string, data: unknown) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}
async function writeText(p: string, data: string) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, data, "utf8");
}

/* ===========================
   数据源：百度热榜（多源聚合 + 直抓回退 + 缓存）
=========================== */

/* c8 ignore start - network and html parsing */
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: defaultHeaders() } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/* c8 ignore next */
function defaultHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/json",
  };
}

/* c8 ignore next */
function toItemsFromVvhan(json: any): TrendItem[] {
  const arr = Array.isArray(json?.data) ? json.data : [];
  return arr.map((x: any, i: number) => ({
    rank: Number(x.index ?? i + 1),
    title: String(x.title ?? "").trim(),
    url: x.url ? String(x.url) : undefined,
    summary: x.desc ? String(x.desc) : undefined,
    hotScore: x.hot ? Number(x.hot) : undefined,
    category: "realtime",
  }));
}

/* c8 ignore next */
function toItemsFromTenApi(json: any): TrendItem[] {
  const arr = Array.isArray(json?.data) ? json.data : [];
  return arr.map((x: any, i: number) => ({
    rank: i + 1,
    title: String(x.name ?? "").trim(),
    url: x.url ? String(x.url) : undefined,
    summary: undefined,
    hotScore: x.hot ? Number(x.hot) : undefined,
    category: "realtime",
  }));
}

/* c8 ignore next */
function toItemsFromFreeJK(json: any): TrendItem[] {
  const arr = Array.isArray(json?.data) ? json.data : [];
  return arr.map((x: any, i: number) => ({
    rank: Number(x.id ?? i + 1),
    title: String(x.title ?? "").trim(),
    url: x.url ? String(x.url) : undefined,
    summary: undefined,
    hotScore: x.hot ? Number(x.hot) : undefined,
    category: json?.name || "realtime",
  }));
}

/* c8 ignore next */
function toItemsFromTian(json: any): TrendItem[] {
  const arr = Array.isArray(json?.result?.list) ? json.result.list : [];
  return arr.map((x: any, i: number) => ({
    rank: i + 1,
    title: String(x.keyword ?? "").trim(),
    url: undefined,
    summary: x.brief ? String(x.brief) : undefined,
    hotScore: x.index ? Number(x.index) : undefined,
    category: "realtime",
  }));
}

/* c8 ignore next */
async function fetchThirdParty(date: string, cfg: Config): Promise<TrendItem[]> {
  void date;
  const endpoints: Array<() => Promise<TrendItem[]>> = [
    async () => {
      const url = "https://api.vvhan.com/api/hotlist/baiduRD";
      const text = await fetchWithTimeout(url, 7000);
      const json = JSON.parse(text);
      if (!json) throw new Error("vvhan empty");
      return toItemsFromVvhan(json);
    },
    async () => {
      const url = "https://tenapi.cn/v2/baiduhot";
      const text = await fetchWithTimeout(url, 7000);
      const json = JSON.parse(text);
      if (json?.code !== 200) throw new Error("tenapi bad code");
      return toItemsFromTenApi(json);
    },
    async () => {
      const url = "https://api.freejk.com/shuju/hotlist/baidu";
      const text = await fetchWithTimeout(url, 7000);
      const json = JSON.parse(text);
      if (json?.code !== 200) throw new Error("freejk bad code");
      return toItemsFromFreeJK(json);
    },
  ];

  if (cfg.tianApiKey) {
    endpoints.push(async () => {
      const url = `https://apis.tianapi.com/nethot/index?key=${encodeURIComponent(cfg.tianApiKey!)}`;
      const text = await fetchWithTimeout(url, 7000);
      const json = JSON.parse(text);
      if (json?.code !== 200) throw new Error("tianapi bad code");
      return toItemsFromTian(json);
    });
  }

  for (const fn of endpoints) {
    try {
      const items = await fn();
      const valid = items.filter((x) => x.title);
      if (valid.length > 0) return dedupeByTitle(valid);
    } catch (e: any) {
      logWarn("third-party source failed", { err: String(e?.message || e) });
    }
  }
  throw new Error("all third-party sources failed");
}

function dedupeByTitle(items: TrendItem[]) {
  const seen = new Set<string>();
  const out: TrendItem[] = [];
  for (const it of items) {
    const key = normalizeTitleForHash(it.title);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  // 按热度或 rank
  return out
    .sort((a, b) => (b.hotScore || 0) - (a.hotScore || 0))
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

/* c8 ignore next */
async function fetchBaiduHtmlParse(): Promise<TrendItem[]> {
  const html = await fetchWithTimeout("https://top.baidu.com/board?tab=realtime", 8000);
  const $ = cheerio.load(html);
  const items: TrendItem[] = [];
  // 尝试从页面常见结构解析，若结构变化则可能返回空
  $("a[href][title]").each((_i: number, el: any) => {
    const title = ($(el).attr("title") || "").trim();
    const href = ($(el).attr("href") || "").trim();
    if (title) {
      items.push({
        rank: items.length + 1,
        title,
        url: href.startsWith("http") ? href : `https://www.baidu.com${href}`,
        category: "realtime",
      });
    }
  });
  // 去重 + 截断
  return dedupeByTitle(items).slice(0, 50);
}
/* c8 ignore stop */

async function fetchTrendsCached(date: string, cfg: Config): Promise<TrendsDay> {
  const cacheDir = path.join(A_ROOT, "daily_trends");
  const cachePath = path.join(cacheDir, `${date}.json`);
  await ensureDir(cacheDir);

  // 读缓存
  try {
    const stat = await fsp.stat(cachePath);
    if (Date.now() - stat.mtimeMs <= cfg.cacheTtlMs) {
      const cached = await readJson<TrendsDay>(cachePath, { date, source: "cache", items: [] });
      if (cached.items.length > 0) {
        logInfo("use cached trends", { date, items: cached.items.length });
        return cached;
      }
    }
  } catch {
    // ignore
  }

  // 拉取
  let items: TrendItem[] = [];
  let source = "third-party";
  try {
    items = await fetchThirdParty(date, cfg);
  } catch {
    logWarn("all third-party endpoints failed, try html parse");
    try {
      items = await fetchBaiduHtmlParse();
      source = "html";
    } catch (e: any) {
      logError("fetch baidu html failed", { err: String(e?.message || e) });
    }
  }

  if (items.length === 0) {
    // 若无网络或失败，尝试使用老缓存（不检查 TTL）
    const cached = await readJson<TrendsDay>(cachePath, { date, source: "none", items: [] });
    if (cached.items.length > 0) {
      logWarn("fallback to stale cache", { date });
      return cached;
    }
  }

  const data: TrendsDay = { date, source, items };
  await writeJson(cachePath, data);
  return data;
}

/* ===========================
   历史与去重
=========================== */
interface HistoryFile {
  version: number;
  updatedAt: string;
  items: HistoryRecord[];
}

/** 根据当前 repoB 路径生成隔离的 history 文件，避免测试或多实例互相干扰 */
function historyFilePath(): string {
  const cfg = loadConfig();
  const suffix = crypto.createHash("sha256").update(cfg.repoBDir, "utf8").digest("hex").slice(0, 8);
  const stateDir = path.join(A_ROOT, "state");
  ensureDirSync(stateDir);
  return path.join(stateDir, `history.${suffix}.json`);
}

async function loadHistory(): Promise<HistoryFile> {
  const p = historyFilePath();
  return await readJson<HistoryFile>(p, { version: 1, updatedAt: nowIso(), items: [] });
}

async function saveHistory(h: HistoryFile) {
  h.updatedAt = nowIso();
  const p = historyFilePath();
  await writeJson(p, h);
}

function makeId(title: string, date: string, edition: string) {
  return sha256(`${normalizeTitleForHash(title)}|${date}|${edition}`);
}

/* ===========================
   主题提取与分类（Gemini 可选，启发式兜底）
=========================== */

function heuristicCandidates(trends: TrendsDay, max: number): CandidateTopic[] {
  const top = trends.items.slice(0, Math.max(1, max));
  return top.map((x) => ({
    title: x.title,
    reason: "来自当日热榜，热度较高且具备讨论价值",
    edition: "v1",
    sourceUrl: x.url,
  }));
}

function heuristicClassify(title: string): { categorySlug: string; categoryDisplay: string; confidence: number } {
  const pairs: Array<[RegExp, string, string]> = [
    [/ai|大模型|模型|机器学习|人工智能|gemini|llm/i, "llm", "大语言模型"],
    [/安全|漏洞|攻击|勒索|黑客|隐私/i, "cybersecurity", "网络安全"],
    [/芯片|硬件|手机|消费电子/i, "consumer-tech", "消费电子与硬件"],
    [/云|k8s|容器|devops|运维/i, "cloud-devops", "云与 DevOps"],
    // 将“产业与公司”优先级提升到“经济与市场”之前，避免“财报”误判
    [/公司|产业|并购|上市|IPO/i, "industry", "产业与公司"],
    [/经济|股市|市场|通胀|财报/i, "economy", "经济与市场"],
    [/游戏|电竞|主机|互动/i, "gaming", "游戏与交互"],
    [/科学|太空|探索|天文/i, "science", "科学与太空"],
    [/医疗|健康|医药|生物/i, "healthcare", "医疗与生物"],
    [/能源|气候|减排|新能源/i, "energy-climate", "能源与气候"],
    [/区块链|比特币|加密/i, "blockchain", "区块链与加密"],
    [/政策|监管|合规|法律/i, "policy", "政策与监管"],
    [/数据|数据库|ETL|BI|数仓/i, "data", "数据与数据库"],
    [/web|前端|移动|小程序|APP/i, "web-mobile", "Web 与移动"],
    [/软件|编程|工程|架构|后端/i, "software-dev", "软件开发与工程"],
    [/媒体|文化|影视|音乐|社交/i, "culture-media", "文化与媒体"],
  ];
  for (const [re, slug, disp] of pairs) {
    if (re.test(title)) return { categorySlug: slug, categoryDisplay: disp, confidence: 0.7 };
  }
  return { categorySlug: "uncategorized", categoryDisplay: "未分类", confidence: 0.3 };
}

async function extractCandidatesViaGemini(trends: TrendsDay, cfg: Config): Promise<CandidateTopic[]> {
  if (!cfg.geminiApiKey || !GoogleGenerativeAI) return heuristicCandidates(trends, cfg.maxTopics);
  try {
    const genAI = new GoogleGenerativeAI(cfg.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: cfg.model, generationConfig: { temperature: cfg.temperature } });
    const topTitles = trends.items.slice(0, 30).map((x, i) => `${i + 1}. ${x.title}`).join("\n");
    const prompt = [
      "请基于以下当日百度热榜标题，挑选不超过5个值得进行深度研究的主题，并输出 JSON 数组。",
      "每个对象包含：title, reason, edition=v1。",
      "仅输出 JSON，不要包含其它文字。",
      topTitles,
    ].join("\n");
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
    const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const json = JSON.parse(safeJson(text));
    const arr = Array.isArray(json) ? json : [];
    const out: CandidateTopic[] = [];
    for (const x of arr) {
      if (x?.title) {
        out.push({
          title: String(x.title),
          reason: String(x.reason || "模型建议"),
          edition: String(x.edition || "v1"),
        });
      }
    }
    return out.length > 0 ? out.slice(0, cfg.maxTopics) : heuristicCandidates(trends, cfg.maxTopics);
  } catch (e: any) {
    logWarn("gemini candidate extraction failed, fallback heuristic", { err: String(e?.message || e) });
    return heuristicCandidates(trends, cfg.maxTopics);
  }
}

async function classifyTopic(topic: CandidateTopic, cfg: Config): Promise<ClassifiedTopic> {
  void cfg;
  // 简化：直接启发式；可扩展 Gemini 分类
  const { categorySlug, categoryDisplay, confidence } = heuristicClassify(topic.title);
  return {
    ...topic,
    categorySlug,
    categoryDisplay,
    confidence,
  };
}

function safeJson(text: string) {
  // 尝试截取首尾 JSON 段
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return "[]";
}

/* ===========================
   报告生成与写入库B
=========================== */

function buildFrontMatter(meta: ReportMeta) {
  return YAML.stringify({
    title: meta.title,
    date: meta.date,
    edition: meta.edition,
    category_slug: meta.categorySlug,
    category_display: meta.categoryDisplay,
    source: meta.source,
    slug: meta.slug,
    run_id: meta.runId,
  });
}

function buildReportMarkdown(meta: ReportMeta, body: { summary: string[]; background: string[]; analysis: string[]; refs: Array<{ name: string; url: string }>; conclusions: string[] }) {
  const fm = buildFrontMatter(meta);
  const lines: string[] = [];
  lines.push("---");
  lines.push(fm.trim());
  lines.push("---");
  lines.push("");
  lines.push("# 摘要");
  for (const s of body.summary) lines.push(`- ${s}`);
  lines.push("");
  lines.push("# 背景");
  for (const s of body.background) lines.push(`- ${s}`);
  lines.push("");
  lines.push("# 深度分析");
  for (const s of body.analysis) lines.push(`- ${s}`);
  lines.push("");
  lines.push("# 数据与引用");
  for (const r of body.refs) lines.push(`- [${r.name}](${r.url})`);
  lines.push("");
  lines.push("# 结论与建议");
  for (const s of body.conclusions) lines.push(`- ${s}`);
  lines.push("");
  return lines.join("\n");
}

async function generateReport(topic: ClassifiedTopic, trends: TrendsDay, cfg: Config, runId: string): Promise<{ markdown: string; meta: ReportMeta }> {
  void cfg;
  const meta: ReportMeta = {
    title: topic.title,
    date: trends.date,
    edition: topic.edition || "v1",
    slug: toSlug(topic.title),
    categorySlug: topic.categorySlug,
    categoryDisplay: topic.categoryDisplay,
    source: topic.sourceUrl || trends.source,
    runId,
  };

  // 如无 Gemini Key，使用模板生成；有 Key 可调用模型补全文案（此处保持离线友好）
  const summary = [
    `主题围绕“${topic.title}”，来自当日百度热榜，模型/启发式评估为值得进一步关注。`,
    `分类：${topic.categoryDisplay}，置信度 ${Math.round(topic.confidence * 100)}%。`,
  ];
  const background = [
    "该主题在社交与媒体渠道有一定关注度，建议结合权威媒体进行交叉验证。",
    "需要注意数据源的可靠性与时效性，谨防谣言与误导性信息。",
  ];
  const analysis = [
    "从用户、产品、技术、市场四个维度进行拆解，识别关键驱动因素与制约条件。",
    "分析与竞品或相邻领域的对比，提炼可迁移的经验与潜在风险。",
    "结合短期与长期影响，评估投入产出与机会窗口。",
  ];
  const refs: Array<{ name: string; url: string }> = [];
  // 添加一条百度搜索链接
  const encoded = encodeURIComponent(topic.title);
  refs.push({ name: "百度搜索", url: `https://www.baidu.com/s?wd=${encoded}` });
  if (topic.sourceUrl) refs.push({ name: "热榜来源", url: topic.sourceUrl });

  const conclusions = [
    "短期：收集一手数据与多源验证，形成最小研究结论草稿并进行同伴评审。",
    "中期：基于初步结论设计行动项与验证指标，建立复盘机制与知识沉淀。",
  ];

  const markdown = buildReportMarkdown(meta, { summary, background, analysis, refs, conclusions });
  return { markdown, meta };
}

async function ensureRepoBStructure(repoB: string) {
  const dirs = [
    repoB,
    path.join(repoB, "AI_Reports"),
    path.join(repoB, "AI_Reports", "uncategorized"),
  ];
  for (const d of dirs) await ensureDir(d);
}

function filePathForReport(repoB: string, meta: ReportMeta) {
  const categoryDir = path.join(repoB, "AI_Reports", meta.categorySlug);
  const fileName = `${safeFileName(meta.title)}-${meta.date}--${meta.edition}.md`; // 保留原始标题，遵循 Code-Map 建议
  return { abs: path.join(categoryDir, fileName), rel: path.join("AI_Reports", meta.categorySlug, fileName) };
}

async function writeReportIfChanged(repoB: string, meta: ReportMeta, markdown: string) {
  const { abs, rel } = filePathForReport(repoB, meta);
  await ensureDir(path.dirname(abs));
  let changed = true;
  try {
    const old = await fsp.readFile(abs, "utf8");
    if (old === markdown) changed = false;
  } catch {
    // not exist
  }
  if (changed) {
    await fsp.writeFile(abs, markdown, "utf8");
  }
  return { pathAbs: abs, pathRel: rel, changed };
}

/* ===========================
   导航与 README 更新
=========================== */

interface ReportIndexItem {
  title: string;
  date: string; // YYYY-MM-DD
  edition: string;
  pathRel: string; // 相对库B根
  categorySlug: string;
  source?: string;
}

async function scanReports(repoB: string): Promise<ReportIndexItem[]> {
  const root = path.join(repoB, "AI_Reports");
  const patterns = ["**/*.md"].map((p) => path.join(root, p).replace(/\\/g, "/"));
  const files = await fg(patterns, { dot: false, onlyFiles: true });
  const out: ReportIndexItem[] = [];
  for (const f of files) {
    try {
      const s = await fsp.readFile(f, "utf8");
      // 解析 front matter（简单解析）
      const m = /^---\s*([\s\S]*?)\s*---/m.exec(s);
      let title = "";
      let date = "";
      let edition = "v1";
      let category_slug = "uncategorized";
      let source: string | undefined;
      if (m) {
        const obj = YAML.parse(m[1] || "") || {};
        title = String(obj.title || "");
        date = String(obj.date || "");
        edition = String(obj.edition || "v1");
        category_slug = String(obj.category_slug || "uncategorized");
        source = obj.source ? String(obj.source) : undefined;
      } else {
        // 从文件名兜底
        const base = path.basename(f, ".md");
        const parts = base.split("--");
        if (parts.length >= 2) {
          const left = parts[0]; // 形如：标题-YYYY-MM-DD
          const ed = parts[1]; // vN
          edition = ed || "v1";
          // 优先使用正则精确提取日期
          const mDate = left.match(/-(\d{4}-\d{2}-\d{2})$/);
          if (mDate) {
            date = mDate[1];
            title = left.slice(0, left.length - mDate[0].length);
          } else {
            // 兜底：按最后一个连字符切分
            const lastDash = left.lastIndexOf("-");
            if (lastDash > 0) {
              title = left.slice(0, lastDash);
              date = left.slice(lastDash + 1);
            } else {
              title = left;
            }
          }
        }
        // 类目兜底
        const rel = path.relative(repoB, f).replace(/\\/g, "/");
        const cat = rel.split("/")[1];
        if (cat) category_slug = cat;
      }
      const rel = path.relative(repoB, f).replace(/\\/g, "/");
      out.push({ title, date, edition, pathRel: rel, categorySlug: category_slug, source });
    } catch {
      // ignore file
    }
  }
  return out;
}

function renderNavigation(items: ReportIndexItem[]): string {
  // 按类目分组，日期倒序，每类取最近 20 条
  const byCat = new Map<string, ReportIndexItem[]>();
  for (const it of items) {
    const arr = byCat.get(it.categorySlug) || [];
    arr.push(it);
    byCat.set(it.categorySlug, arr);
  }
  const catOrder = Array.from(byCat.keys()).sort();
  const lines: string[] = [];
  for (const cat of catOrder) {
    lines.push(`## ${displayNameForCategory(cat)} (${cat})`);
    lines.push("");
    lines.push("<details><summary>展开/收起</summary>");
    lines.push("");
    const arr = (byCat.get(cat) || []).sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 20);
    for (const it of arr) {
      const titleDisp = safeFileName(it.title || path.basename(it.pathRel, ".md"));
      const src = it.source ? ` [来源](${it.source})` : "";
      lines.push(`- [${titleDisp} - ${it.date}](${it.pathRel}) (${it.edition})${src}`);
    }
    if (arr.length === 0) lines.push("- 暂无数据");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  return lines.join("\n");
}

function displayNameForCategory(slug: string) {
  const map: Record<string, string> = {
    "ai-ml": "AI 与机器学习",
    llm: "大语言模型",
    "software-dev": "软件开发与工程",
    cybersecurity: "网络安全",
    "cloud-devops": "云与 DevOps",
    data: "数据与数据库",
    "web-mobile": "Web 与移动",
    "consumer-tech": "消费电子与硬件",
    gaming: "游戏与交互",
    blockchain: "区块链与加密",
    science: "科学与太空",
    healthcare: "医疗与生物",
    "energy-climate": "能源与气候",
    economy: "经济与市场",
    policy: "政策与监管",
    industry: "产业与公司",
    "culture-media": "文化与媒体",
    uncategorized: "未分类",
  };
  return map[slug] || slug;
}

async function updateNavigation(repoB: string) {
  const navPath = path.join(repoB, "NAVIGATION.md");
  const items = await scanReports(repoB);
  const contentNew = [
    "# DeepResearch 报告导航",
    "",
    "本文件由项目 A 自动生成/更新（幂等）。请勿手工编辑“NAV:START/NAV:END”之间内容。",
    "",
    `更新时间: <!-- UPDATED_AT -->${nowIso()}<!-- /UPDATED_AT -->`,
    "",
    "<!-- NAV:START version=1 maxPerCategory=20 collapsible=true -->",
    "",
    renderNavigation(items),
    "",
    "<!-- NAV:END -->",
    "",
  ].join("\n");

  let final = contentNew;
  try {
    const old = await fsp.readFile(navPath, "utf8");
    // 仅替换 NAV:START..NAV:END 区域
    const start = old.indexOf("<!-- NAV:START");
    const end = old.indexOf("<!-- NAV:END");
    if (start >= 0 && end >= 0) {
      const before = old.slice(0, start).trimEnd();
      const after = old.slice(end + "<!-- NAV:END -->".length).trimStart();
      final = [before, contentNew, after].join("\n\n");
    }
  } catch {
    // file not exist
  }
  await writeText(navPath, final);
  return { path: navPath };
}

async function updateReadmeToday(repoB: string, date: string, max = 20) {
  const readmePath = path.join(repoB, "README.md");
  let old = "";
  try {
    old = await fsp.readFile(readmePath, "utf8");
  } catch {
    // 不存在则创建基础骨架
    old = [
      "# DeepResearch — Today's Reports",
      "",
      "本页仅展示“当日最新报告”。历史与按分类的完整导航请见 NAVIGATION.md。此页内容由项目 A 自动生成并每日更新。",
      "",
      "日期 Date: <!-- DATE -->1970-01-01<!-- /DATE -->",
      "",
      "## 今日报告 Today",
      "",
      "<!-- TODAY_REPORTS:START max=20 -->",
      "- 暂无数据（等待项目 A 首次推送）",
      "<!-- TODAY_REPORTS:END -->",
      "",
    ].join("\n");
  }

  // 收集当日文件
  const items = await scanReports(repoB);
  const todays = items.filter((x) => x.date === date).sort((a, b) => (a.pathRel > b.pathRel ? -1 : 1)).slice(0, max);
  const list = todays.length
    ? todays.map((x) => `- [${safeFileName(x.title)}](${x.pathRel}) (${x.edition})`).join("\n")
    : "- 暂无数据";

  const dateReplaced = old.replace(/(<!-- DATE -->)(.*?)(<!-- \/DATE -->)/s, (_m, a, _b, c) => `${a}${date}${c}`);
  const final = dateReplaced.replace(
    /(<!-- TODAY_REPORTS:START[\s\S]*?-->)([\s\S]*?)(<!-- TODAY_REPORTS:END -->)/m,
    (_m, a, _b, c) => `${a}\n${list}\n${c}`,
  );
  await writeText(readmePath, final);
  return { path: readmePath };
}

/* ===========================
   Orchestrator 主流程
=========================== */

export async function runDaily(mode: "daily" | "nav" | "readme" = "daily") {
  const cfg = loadConfig();
  const runId = `${cfg.timezone}:${todayStr(cfg.timezone)}:${Math.random().toString(36).slice(2, 8)}`;
  logInfo("run:start", { mode, runId });

  await ensureRepoBStructure(cfg.repoBDir);

  if (mode === "nav") {
    await updateNavigation(cfg.repoBDir);
    logInfo("run:end", { mode, ok: true });
    return;
  }
  if (mode === "readme") {
    await updateReadmeToday(cfg.repoBDir, todayStr(cfg.timezone), cfg.todayMaxOnReadme);
    logInfo("run:end", { mode, ok: true });
    return;
  }

  // daily
  const date = todayStr(cfg.timezone);
  const trends = await fetchTrendsCached(date, cfg);
  if (!trends.items.length) {
    logWarn("no trends items for today, exit gracefully");
    await updateReadmeToday(cfg.repoBDir, date, cfg.todayMaxOnReadme);
    await updateNavigation(cfg.repoBDir);
    logInfo("run:end", { mode, ok: true, reason: "empty-trends" });
    return;
  }

  const history = await loadHistory();

  const candidates = await extractCandidatesViaGemini(trends, cfg);
  if (!candidates.length) {
    logWarn("no candidates extracted, exit gracefully");
    await updateReadmeToday(cfg.repoBDir, date, cfg.todayMaxOnReadme);
    await updateNavigation(cfg.repoBDir);
    logInfo("run:end", { mode, ok: true, reason: "empty-candidates" });
    return;
  }

  const limit = pLimit(cfg.concurrent);
  const results = await Promise.all(
    candidates.map((cand) =>
      limit(async () => {
        const classified = await classifyTopic(cand, cfg);
        const id = makeId(classified.title, date, classified.edition);
        // 去重
        if (history.items.some((x) => x.id === id && x.status === "ok")) {
          logInfo("duplicate topic skip", { title: classified.title, date, edition: classified.edition });
          return { skipped: true };
        }
        // 标记 pending
        const recPending: HistoryRecord = {
          id,
          title: classified.title,
          date,
          edition: classified.edition,
          categorySlug: classified.categorySlug,
          slug: toSlug(classified.title),
          path: "",
          source: classified.sourceUrl || trends.source,
          runId,
          status: "pending",
          updatedAt: nowIso(),
        };
        history.items = history.items.filter((x) => x.id !== id).concat(recPending);
        await saveHistory(history);

        // 生成报告（带重试）
        const { markdown, meta } = await pRetry(
          () => generateReport(classified, trends, cfg, runId),
          {
            retries: cfg.retryMax,
            factor: cfg.retryFactor,
            minTimeout: cfg.retryInitialMs,
          },
        );

        // 幂等写入库B
        const { pathRel, changed } = await writeReportIfChanged(cfg.repoBDir, meta, markdown);

        // 标记 ok
        const recOk: HistoryRecord = {
          ...recPending,
          status: "ok",
          path: pathRel,
          updatedAt: nowIso(),
        };
        history.items = history.items.filter((x) => x.id !== id).concat(recOk);
        await saveHistory(history);

        return { skipped: false, changed, pathRel, title: meta.title };
      }),
    ),
  );

  // 更新导航与 README
  await updateNavigation(cfg.repoBDir);
  await updateReadmeToday(cfg.repoBDir, date, cfg.todayMaxOnReadme);

  const changedCount = results.filter((x: any) => x && !x.skipped && x.changed).length;
  logInfo("run:end", { mode, ok: true, generated: changedCount });
}

/* ===========================
   导出
=========================== */
export const _internal = {
  // orchestrator pieces
  fetchTrendsCached,
  extractCandidatesViaGemini,
  classifyTopic,
  generateReport,
  writeReportIfChanged,
  updateNavigation,
  updateReadmeToday,
  loadConfig,
  // helpers for tests
  buildFrontMatter,
  buildReportMarkdown,
  filePathForReport,
  // internal utils
  sha256,
  makeId,
  safeFileName,
  toSlug,
  // navigation helpers
  // @ts-ignore - expose for testing coverage
  scanReports,
  // @ts-ignore - expose for testing coverage
  renderNavigation,
  // @ts-ignore - expose for testing coverage
  displayNameForCategory,
};