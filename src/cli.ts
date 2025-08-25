/* eslint-disable no-console */
import { runDaily, loadConfig } from "./app";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (typeof v === "undefined") {
        const peek = args[i + 1];
        if (peek && !peek.startsWith("--")) {
          out[k] = peek;
          i++;
        } else {
          out[k] = true;
        }
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = String(args.mode || "daily") as "daily" | "nav" | "readme";

  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  const cfg = loadConfig();
  console.info(`[GemFlow2] Start mode=${mode} repoB=${cfg.repoBDir}`);
  await runDaily(mode);
  console.info("[GemFlow2] Done");
}

function printHelp() {
  const lines = [
    "GemFlow2 CLI",
    "",
    "Usage:",
    "  tsx src/cli.ts --mode daily    # 开始完整流程",
    "  tsx src/cli.ts --mode nav      # 仅重建 NAVIGATION.md",
    "  tsx src/cli.ts --mode readme   # 仅更新 README.md 今日报告区域",
    "",
    "Env:",
    "  GEMINI_API_KEY / GOOGLE_API_KEY    Gemini 鉴权",
    "  GEMINI_MODEL=gemini-2.5-pro        模型名",
    "  REPO_B_DIR=./DeepResearch-Archive  库B路径",
    "  TZ=Asia/Shanghai                   时区",
    "  MAX_TOPICS=5                       当日主题上限",
    "  README_TODAY_MAX=20                今日 README 展示上限",
    "  DRY_RUN=false                      干跑",
  ];
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("[GemFlow2] Failed", err?.stack || err);
  process.exit(1);
});