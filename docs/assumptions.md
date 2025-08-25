# 假设与约束说明 — GemFlow2
更新时间：2025-08-21（UTC+8）

关联文档：[`docs/plan.md`](../docs/plan.md) · [`docs/design.md`](../docs/design.md) · [`Code-Map.md`](../../Code-Map.md) · 库B [`DeepResearch-Archive/NAVIGATION.md`](../../DeepResearch-Archive/NAVIGATION.md) [`DeepResearch-Archive/README.md`](../../DeepResearch-Archive/README.md)

---

## 1. 背景与目的
- 记录当前信息缺失处的合理假设，便于在实现中落地与在评审时校准。
- 对每条假设给出备选方案与权衡；当事实与假设不符时，按本文档的回滚预案与风险策略执行。

## 2. 总体假设清单

### 2.1 运行与环境
- Node.js 18 LTS 可用；系统为 Windows 11 与 Linux CI 双环境，路径与换行按平台自适应。
- 仅对接 Gemini AI Studio REST；不使用 Vertex AI 与 OpenAI。
- 时区固定为 Asia/Shanghai；每日“当天”按该时区界定。
- `.env` 文件可放置在项目根目录，运行时加载优先级：环境变量 > `.env` > 默认值。

### 2.2 凭据与安全
- 通过 `GEMINI_API_KEY` 或 `GOOGLE_API_KEY` 提供模型鉴权；仓库不保存明文密钥。
- 若将结果推送到远端库B，使用最小权限 PAT（仅 contents:write）。
- 日志默认脱敏，避免输出完整密钥或用户输入原文。

### 2.3 数据源与网络
- 百度未提供稳定官方 JSON API，采用“第三方聚合 API 优先 + 原站直抓回退”的双通道策略。
- 第三方接口结构可能非稳定，解析做宽松容错并标准化到内部模型。
- 为避免频繁访问，使用 `daily_trends/{yyyy-mm-dd}.json` 作为 24h 缓存，优先读缓存。

### 2.4 持久化与目录
- 运行状态与历史指纹存于 `state/history.json`；结构包含 version、updatedAt、items[]。
- 库B路径默认使用工作区内的 [`DeepResearch-Archive`](../../DeepResearch-Archive/README.md)。
- 报告写入规则遵循 [Code-Map.md](../../Code-Map.md) 的结构与命名。

### 2.5 幂等与去重
- 指纹计算：`sha256(normalizedTitle + date + edition)`；normalizedTitle 统一大小写、去空白与标点。
- 同日同主题同版次不重复生成；导航与 README 采用纯函数式重建。

### 2.6 流程与并发
- 主题处理并发默认 4；对模型调用启用 RPM 与 TPM 速率限制，溢出排队。
- 重试策略：指数退避，初始 500ms，factor 2，最大 3 次；4xx 配置错误不重试。
- 单次运行总超时与每步超时可配置，默认总 120s、每步 30s。

### 2.7 模板与渲染
- 报告采用 YAML front matter + Markdown 正文，含摘要、背景、分析、引用、结论。
- 导航 NAVIGATION 与首页 README 由扫描生成，包含可折叠分组与“今日报告”占位更新。

### 2.8 质量与交付
- 单元+集成覆盖率目标 ≥ 80%，CI 强制门槛。
- 构建产物为 ESM + CJS + 类型声明；通过 `tsup` 产出。
- 提交信息遵循 Conventional Commits；main 为稳定分支。

## 3. 可选方案与权衡

### 3.1 数据源获取
- 方案A 多源聚合优先：先调用第三方接口，失败再直抓原站。
  - 优点：上手快、对源站压力小；缺点：第三方可能限流或结构变化。
- 方案B 仅直抓原站：直接解析 `https://top.baidu.com/board?tab=realtime`。
  - 优点：可控性高；缺点：页面结构可能变动，需要维护解析逻辑。
- 折中：默认方案A，且强制 24h 缓存；抓取失败回退最近成功缓存。

### 3.2 写入库B方式
- 方案A 本地写入工作区 [`DeepResearch-Archive`](../../DeepResearch-Archive/README.md)，用于快速联调。
- 方案B GitHub API 远端写入，使用 PAT；适合生产自动化。
- 决策：先本地，待验证稳定后引入远端写入路径。

### 3.3 文件命名与 slug
- 文件名采用“标题-日期--版次.md”，保留原始标题；front matter 中固定 `slug`。
- 目录使用 `categorySlug`（URL 安全小写短横线），展示名与目录名解耦。
- 兼容策略：非法字符标准化；必要时保留显示名映射表。

### 3.4 导航生成策略
- 纯函数扫描 `AI_Reports/**` 重建；按类目与日期倒序，最近 N 条展示，其余折叠。
- 优点：幂等、可恢复；缺点：首次扫描可能较慢（但 N 与文件数有限，影响可接受）。

### 3.5 日志与可观测性
- 结构化 jsonl 日志，按天分文件；提供事件总线订阅。
- DEBUG 可选，避免在生产中过量记录；敏感字段脱敏。

### 3.6 配置加载
- 运行时合并：process.env → `.env` → 默认值；使用 zod 校验与类型安全导出。
- 坏路径：缺失必填项时快速失败并给出可操作提示。

## 4. 风险清单与缓解
- 第三方接口不可用或变更
  - 缓解：多源切换、指数退避；失败回退最近缓存；记录告警事件。
- 原站页面结构变动
  - 缓解：解析器多选择器容错；优先提取内嵌 JSON；失败降级为缓存。
- 模型额度与速率限制
  - 缓解：并发限流与排队；失败重试；必要时降级减少主题数。
- 文件系统权限或编码问题
  - 缓解：统一 UTF-8、规范化路径；写前建目录；失败时输出诊断并跳过该项。
- 幂等冲突与命名碰撞
  - 缓解：使用指纹去重与 `--vN` 版次；写前 diff 检测，空变更不写。
- CI 构建与依赖漏洞
  - 缓解：锁定版本与审计；阻断高危依赖；使用缓存与并行优化缩短时间。

## 5. 回滚预案
- 以版本与 `runId` 为单位回滚：若导航/首页异常，使用上一次成功构建的快照覆盖。
- 写库B失败：保留未写入的报告到临时目录并输出清单；人工修复后补写。
- 模型调用异常：降级到最少主题数或暂停当日生成；次日自动恢复。

## 6. 开放问题与待确认
- 类目映射是否固定？若需变更，映射表由库A维护到何处？
- 每日最大主题数上限是多少（默认 5）？
- README 今日展示的最大条数（默认 20）？
- 是否需要远端提交到 GitHub 仓库B（默认先本地）？
- 是否允许在报告中插入外部链接白名单（默认允许，需校验）？

## 7. 决策记录模板（ADR）

```md
# 决策标题
日期: 2025-08-21
决策: 采纳/拒绝/延后
背景: 触发决策的上下文与约束
选项: 方案A / 方案B / 方案C
权衡: 各选项优缺点与影响
结论: 被采纳方案与理由
后续: 需要的实施步骤与验证点
追踪: [`docs/plan.md`](../docs/plan.md) · [`Code-Map.md`](../../Code-Map.md)
```

## 8. 追踪引用
- 计划文档：[`docs/plan.md`](../docs/plan.md)
- 设计文档：[`docs/design.md`](../docs/design.md)
- 代码地图：[`Code-Map.md`](../../Code-Map.md)
- 库B导航：[`DeepResearch-Archive/NAVIGATION.md`](../../DeepResearch-Archive/NAVIGATION.md)
- 库B首页：[`DeepResearch-Archive/README.md`](../../DeepResearch-Archive/README.md)

---
说明：本文档在实现推进过程中持续更新；当任何假设与现实不一致时，应首先更新本文档与相关实现，再提交变更。