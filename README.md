# GemFlow2

基于 LangGraph 思想与 Gemini（可选）的每日 DeepResearch 自动化（库 A）。提供“热榜抓取 → 主题提取与分类 → 报告生成 → 写入库 B → 更新导航与首页”的端到端最小闭环，默认对接本仓库中的库 B 目录 `DeepResearch-Archive/`，可本地一键运行与验证。

- Orchestrator 实现：[src/app.ts](GemFlow2/src/app.ts)
- CLI 入口：[src/cli.ts](GemFlow2/src/cli.ts)
- 对外导出：[src/index.ts](GemFlow2/src/index.ts)
- 测试样例：[src/__tests__/core.spec.ts](GemFlow2/src/__tests__/core.spec.ts)
- 设计与计划：[/GemFlow2/docs/design.md](GemFlow2/docs/design.md) · [/GemFlow2/docs/plan.md](GemFlow2/docs/plan.md)

## 特性

- 多源聚合百度热榜 + 直抓回退 + 24h 本地缓存
- 主题提取与分类：Gemini 可选，无 Key 时启发式兜底
- Markdown 报告（YAML front matter），幂等写入库 B
- 自动重建 `NAVIGATION.md` 与更新库 B `README.md` 的“今日报告”区块
- 指纹去重与 `state/history.json` 状态跟踪，失败不影响其他主题
- 一键 CLI 与最小 CI 流水线（安装/构建/lint/typecheck/测试/打包）

## 快速开始

要求：Node.js ≥ 18，npm ≥ 10（建议）。本地默认写入本仓库内 `DeepResearch-Archive/`。

1) 安装依赖
```bash
npm ci
```

2) 一键运行（默认执行全流程）
```bash
npm run dev
# 等价：tsx src/cli.ts
```

3) 构建与运行（产物位于 dist/）
```bash
npm run build
node dist/cli.cjs --mode daily
```

可选模式：
```bash
# 仅重建导航文件 NAVIGATION.md
node dist/cli.cjs --mode nav

# 仅更新库B README 今日区块
node dist/cli.cjs --mode readme
```

## 环境变量

示例见 `.env.example`。支持通过 `.env` 或系统环境变量提供，优先级：环境变量 > .env > 默认值。

- GEMINI_API_KEY / GOOGLE_API_KEY：可选，提供则启用 Gemini 主题抽取
- GEMINI_MODEL：默认 `gemini-2.5-pro`
- GEMINI_TEMPERATURE：默认 `0.3`
- REPO_B_DIR：库 B 路径（默认 `./DeepResearch-Archive`）
- TZ：默认 `Asia/Shanghai`
- MAX_TOPICS：当日主题上限（默认 5）
- README_TODAY_MAX：README 当日展示上限（默认 20）
- DRY_RUN：`true/false`（默认 `false`）
- RETRY_MAX / RETRY_INITIAL_MS / RETRY_FACTOR：重试策略
- RATE_LIMIT_CONCURRENT：并发上限（默认 4）

## 运行与调试

- 主流程：[runDaily()](GemFlow2/src/app.ts:854)
- 配置加载：[loadConfig()](GemFlow2/src/app.ts:169)

本地日志输出为结构化行（stdout），关键阶段产生 `INFO/WARN/ERROR`，后续可扩展 jsonl 文件输出与事件订阅。

## 输出产物（库 B）

默认本仓库根目录的 `DeepResearch-Archive/`：
- 报告：`AI_Reports/<category_slug>/<title>-<date>--v<edition>.md`
- 导航：`NAVIGATION.md`
- 首页今日摘要：`README.md` 中的 `<!-- TODAY_REPORTS:START ... -->` 区块

## 测试与质量

```bash
# Lint
npm run lint

# 类型检查
npm run typecheck

# 单元/集成测试
npm run test

# 覆盖率报告
npm run test:coverage
```

测试配置： [vitest.config.ts](GemFlow2/vitest.config.ts)  
示例用例：验证分类启发、幂等写入与导航/README 更新，见 [src/__tests__/core.spec.ts](GemFlow2/src/__tests__/core.spec.ts)。

## 构建与发布

- 打包：`npm run build`（tsup 产出 ESM + CJS + d.ts）
- 版本注入：`tsup.config.ts` 注入 `BUILD_TIME`
- 发布：建议配合 CI 生成构件与 changelog（后续可接入 npm 发布流程）

## CI（最小）

仓库提供 GitHub Actions 工作流（见 `.github/workflows/ci.yml`）：
- 安装 → Lint → Typecheck → Test(含覆盖率) → Build
- 上传覆盖率与打包构件为 artifacts

## 架构与设计

详见 [docs/design.md](GemFlow2/docs/design.md)。当前为“单文件可运行最小闭环”，后续可按模块边界拆分为：
- config / logger-event / storage / datasource / topic / graph / report / repob / nav / readme / history

对外 API（包导出）：
- [TypeScript.runDaily()](GemFlow2/src/app.ts:854)
- [TypeScript.loadConfig()](GemFlow2/src/app.ts:169)
- 内部工具聚合： [_internal](GemFlow2/src/app.ts:961)

## 故障排查

- 当日无热榜或网络不可用：使用缓存回退，最终仅更新导航与 README 提示
- 429/超时：指数退避；多源聚合自动切换
- 重复主题：指纹去重，日志提示“duplicate topic skip”
- 路径/命名异常：自动替换非法字符，保留显示名

## 目录结构

```
GemFlow2/
├─ src/
│  ├─ app.ts              # Orchestrator（最小闭环）
│  ├─ cli.ts              # CLI 入口
│  ├─ index.ts            # 包导出
│  └─ __tests__/          # 测试
├─ docs/                  # 计划/设计/假设
├─ state/                 # 运行状态（history.json）
├─ daily_trends/          # 热榜缓存
├─ tsup.config.ts
├─ vitest.config.ts
└─ package.json
DeepResearch-Archive/     # 库 B（本地演示写入）
```

## 端到端本地验证

1) 确认 `DeepResearch-Archive/` 目录存在（仓库已包含）
2) 执行 `npm run dev` 或 `node dist/cli.cjs --mode daily`
3) 观察：
   - 在 `DeepResearch-Archive/AI_Reports/**` 生成当日报告
   - `DeepResearch-Archive/NAVIGATION.md` 更新
   - `DeepResearch-Archive/README.md` 的当天区块更新

## License

MIT