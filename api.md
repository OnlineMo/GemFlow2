# 常用服务 API 速查手册（离线版）

面向 GemFlow2 与  集成所需的关键 API 与数据获取方法。所有示例均可在离线前准备好请求样例与说明，在线时一次性验证后保存以备断网环境参考。

更新时间：2025-08-21（UTC+8）

---

## 目录
- [1. Google Gemini API（AI Studio REST）](#1-google-gemini-apiai-studio-rest)
  - [1.1 基本说明](#11-基本说明)
  - [1.2 常用端点与用途](#12-常用端点与用途)
  - [1.3 通用请求头与鉴权](#13-通用请求头与鉴权)
  - [1.4 示例：同步生成 generateContent](#14-示例同步生成-generatecontent)
  - [1.5 示例：SSE 流式 streamGenerateContent](#15-示例sse-流式-streamgeneratecontent)
  - [1.6 示例：统计 tokens 数量 countTokens](#16-示例统计-tokens-数量-counttokens)
  - [1.7 示例：列出可用模型 list](#17-示例列出可用模型-list)
  - [1.8 返回结构参考与常见字段](#18-返回结构参考与常见字段)
  - [1.9 速率限制与错误提示要点](#19-速率限制与错误提示要点)
- [2. 百度热榜获取方法](#2-百度热榜获取方法)
  - [2.1 方案 A：第三方聚合 API（推荐上手快）](#21-方案-a第三方聚合-api推荐上手快)
    - [2.1.1 vvhan 接口](#211-vvhan-接口)
    - [2.1.2 TenAPI 接口](#212-tenapi-接口)
    - [2.1.3 FreeJK 接口](#213-freejk-接口)
    - [2.1.4 TianAPI 接口（需注册 Key）](#214-tianapi-接口需注册-key)
  - [2.2 方案 B：直接抓取原站并解析（稳定性更可控）](#22-方案-b直接抓取原站并解析稳定性更可控)
    - [2.2.1 原理说明](#221-原理说明)
    - [2.2.2 抓取请求与头部](#222-抓取请求与头部)
    - [2.2.3 解析产出数据示例](#223-解析产出数据示例)

---

## 1. Google Gemini API（AI Studio REST）

适用于 quickstart 后端 LangGraph 代理在服务端侧调用。示例基于 AI Studio REST（非 Vertex AI），便于本地开发与轻部署。项目参考见仓库 README（结构与运行方式）；端点与用法参考官方文档（countTokens、流式 SSE 等）(, 。

### 1.1 基本说明
- 基础 URL：`https://generativelanguage.googleapis.com/v1beta/`
- 模型名举例（以 2025-08-21 为准）：`gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.0-flash` 等（以 ListModels 为准）。
- 典型消息体结构：`contents` 数组，元素含 `role` 与 `parts`（文本/多模态）。

### 1.2 常用端点与用途
- 同步生成：`POST /models/{model}:generateContent`
- 流式生成（SSE）：`POST /models/{model}:streamGenerateContent?alt=sse`
- Token 统计：`POST /models/{model}:countTokens`
- 列出模型：`GET /models`
上述端点与示例在官方资料与示例中均有体现（SSE 需 `?alt=sse` 参数）(, 。

### 1.3 通用请求头与鉴权
- Content-Type: `application/json`
- 鉴权方式（其一）：
  - 查询参数：`?key=YOUR_GEMINI_API_KEY`
  - 或请求头：`x-goog-api-key: YOUR_GEMINI_API_KEY`
- 可选：`x-goog-user-project`（绑定结算项目时）

### 1.4 示例：同步生成 generateContent
接口
- URL：`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=YOUR_GEMINI_API_KEY`
- 方法：`POST`
- 头部：`Content-Type: application/json`
- 请求体（JSON）：
```json
{
  "contents": [
    { "role": "user", "parts": [ { "text": "用要点说明Rust与Go在并发内存占用上的差异" } ] }
  ],
  "generationConfig": { "temperature": 0.3 }
}
```
- 返回示例（节选）：
```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [ { "text": "- Rust 倾向零成本抽象...\n- Go 使用GC，存在停顿与开销..." } ]
      },
      "finishReason": "STOP",
      "index": 0
    }
  ],
  "usageMetadata": { "promptTokenCount": 45, "candidatesTokenCount": 128, "totalTokenCount": 173 }
}
```

### 1.5 示例：SSE 流式 streamGenerateContent
接口
- URL：`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=YOUR_GEMINI_API_KEY`
- 方法：`POST`
- 头部：`Content-Type: application/json`
- 请求体（JSON）：
```json
{
  "contents": [
    { "role": "user", "parts": [ { "text": "请分段逐步输出：如何设计可扩展的多步研究代理？" } ] }
  ]
}
```
- SSE 返回为多行事件流，形如：
```
data: {"candidates":[{"content":{"parts":[{"text":"第1段..."}]}]}]}
data: {"candidates":[{"content":{"parts":[{"text":"第2段..."}]}]}]}
...
```
说明：SSE 需 `alt=sse` 参数；不同资料对流式端点命名存在差异，但 `streamGenerateContent?alt=sse` 为官方示例可用形式。(, 

### 1.6 示例：统计 tokens 数量 countTokens
接口
- URL：`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:countTokens?key=YOUR_GEMINI_API_KEY`
- 方法：`POST`
- 请求体（JSON）：
```json
{
  "contents": [
    { "role": "user", "parts": [ { "text": "Estimate tokens for this prompt." } ] }
  ]
}
```
- 返回示例：
```json
{ "totalTokens": 142 }
```
参考：AI Studio token 统计端点说明。

### 1.7 示例：列出可用模型 list
接口
- URL：`https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_GEMINI_API_KEY`
- 方法：`GET`
- 返回示例（节选）：
```json
{
  "models": [
    {
      "name": "models/gemini-2.5-pro",
      "supportedGenerationMethods": ["generateContent", "countTokens"]
    },
    {
      "name": "models/gemini-2.5-flash",
      "supportedGenerationMethods": ["generateContent", "countTokens"]
    }
  ]
}
```

### 1.8 返回结构参考与常见字段
- `candidates[].content.parts[].text`：文本结果增量/完整片段
- `finishReason`：停止原因（如 `STOP`）
- `usageMetadata`：tokens 计数
- `safetyRatings`：安全分类与概率
- `citations` / `citationMetadata`：引用信息（研究/检索类回答）

### 1.9 速率限制与错误提示要点
- 常见 HTTP 状态：429（限流）、503（服务不可用）、404（模型不可用或拼写错误）
- 近期社区反馈显示免费配额与令牌限制可能调整，遇到频繁 429/配额收紧需关注模型与配额公告并实现指数退避重试。

---

## 2. 百度热榜获取方法

由于百度未提供公开稳定的官方 REST JSON 接口，实践中有两类策略：
- 使用第三方聚合 API（上手快、但稳定性受第三方影响）
- 直接抓取官方热榜页并解析（依赖页面结构，需适配变动）

在 GemFlow2 中推荐优先封装“第三方 API + 本地缓存 + 失败回退至直抓解析”的双通道方案。

### 2.1 方案 A：第三方聚合 API（推荐上手快）

以下列出常见且活跃的第三方接口（实际可用性以当时为准，建议本地落盘缓存 24h 并容错切换）：

#### 2.1.1 vvhan 接口
- 地址：`https://api.vvhan.com/api/hotlist/baiduRD`
- 方法：`GET`
- 鉴权：无需
- 请求参数：无
- 返回示例（节选）：
```json
{
  "success": true,
  "data": [
    { "index": 1, "title": "示例热搜A", "desc": "", "hot": "4820774", "url": "https://www.baidu.com/s?wd=..." }
  ]
}
```
来源：vvhan 文档页面（百度热点热榜 API）

#### 2.1.2 TenAPI 接口
- 地址：`https://tenapi.cn/v2/baiduhot`
- 方法：`GET`
- 鉴权：部分场景无需；如开启限流保护可能需要注册
- 请求参数：无
- 返回示例（节选）：
```json
{
  "code": 200,
  "msg": "success",
  "data": [
    { "name": "示例热搜B", "hot": "4940043", "url": "https://www.baidu.com/s?wd=..." }
  ]
}
```
参考：第三方文档示例（baiduhot）

#### 2.1.3 FreeJK 接口
- 地址：`https://api.freejk.com/shuju/hotlist/baidu`
- 方法：`GET`
- 鉴权：无需
- 请求参数：可选 `type` 指定类别（如 `realtime`/`novel` 等，具体以响应 `params.type` 为准）
- 返回示例（节选）：
```json
{
  "code": 200,
  "name": "baidu",
  "title": "百度",
  "total": 50,
  "data": [
    { "id": 0, "title": "示例热搜C", "hot": 7978743, "url": "https://www.baidu.com/s?wd=..." }
  ]
}
```
参考：FreeJK 热榜 API 文档页（含百度示例）

#### 2.1.4 TianAPI 接口（需注册 Key）
- 地址：`https://apis.tianapi.com/nethot/index`
- 方法：`GET` / `POST`
- 鉴权：需要 `key` 参数（注册后获取）
- 请求参数：
  - `key`: string，必填
- 返回示例（节选）：
```json
{
  "code": 200,
  "msg": "success",
  "result": {
    "list": [
      { "keyword": "示例热搜D", "brief": "简介...", "index": "2902308", "trend": "rise" }
    ]
  }
}
```
参考：TianAPI 文档（百度热搜榜）

> 生产建议：为上述第三方入口实现“多源聚合 + 本地缓存 + 指纹去重”，优先使用可用性最高的源；当源返回异常或结构变化时自动切换并记录告警。

### 2.2 方案 B：直接抓取原站并解析（稳定性更可控）

#### 2.2.1 原理说明
- 目标页：`https://top.baidu.com/board?tab=realtime`
- 页面中包含一段内嵌 JSON（常见为注释块 `<!--s-data: ... -->`），可直接提取再 `JSON.parse`。
- 相较第三方，直抓可控性强，但需关注选择器/注释标记变动与频率限制。

#### 2.2.2 抓取请求与头部
- 方法：`GET`
- 必要头部（推荐）：
  - `User-Agent: Mozilla/5.0 ...`
  - `Accept-Language: zh-CN,zh;q=0.9`
  - `Accept: text/html,application/xhtml+xml`
- 频率控制：建议 ≥ 10 秒/次，并设置 24h 缓存文件，如 

#### 2.2.3 解析产出数据示例
- 抽取后的标准化 JSON（建议结构）：
```json
{
  "date": "2025-08-21",
  "source": "https://top.baidu.com/board?tab=realtime",
  "items": [
    {
      "rank": 1,
      "title": "示例热搜E",
      "summary": "可选的简述",
      "hotScore": 7890123,
      "url": "https://www.baidu.com/s?wd=%E7%A4%BA%E4%BE%8B",
      "appUrl": "baiduboxapp://...",
      "category": "realtime"
    }
  ]
}
```

---

## 参考与备注
- quickstart 工程结构、依赖与本地运行方式见其 README（需在线访问校对版本信息）
- Gemini REST 流式 SSE 用 `streamGenerateContent?alt=sse`，返回为事件流；同时可用 `generateContent` 获取一次性完整结果。官方与示例资源已展示可行请求形态与响应片段。(, 
- tokens 统计以 `countTokens` 为准；正式配额与限流以账号面板为准。
