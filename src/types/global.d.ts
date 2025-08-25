// 轻量 Node 与第三方模块类型垫片，便于在未安装 @types/node 等情况下通过编译
// 注意：仅用于开发期兜底，生产环境请安装完整类型

// 全局变量与基本 API
declare var process: any;
declare var require: any;
declare var console: any;

declare class AbortController {
  signal: any;
  abort(): void;
}
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(handle: any): void;

// Node 内置模块简化声明
declare module "node:fs" {
  const x: any;
  export = x;
}
declare module "node:fs/promises" {
  const x: any;
  export = x;
}
declare module "node:path" {
  const x: any;
  export = x;
}
declare module "node:crypto" {
  const x: any;
  export = x;
}
declare module "node:url" {
  const x: any;
  export = x;
}

// 第三方模块最小声明

declare module "undici" {
  export const fetch: any;
}

declare module "cheerio" {
  const cheerio: any;
  export = cheerio;
}

declare module "yaml" {
  const YAML: any;
  export default YAML;
}

declare module "fast-glob" {
  const fg: any;
  export = fg;
}

declare module "date-fns-tz" {
  export function format(date: any, formatStr: string, options?: any): string;
  export function utcToZonedTime(date: any, timeZone: string): any;
}

declare module "slugify" {
  const slugify: (str: string, opts?: any) => string;
  export default slugify;
}

declare module "p-limit" {
  const pLimit: (concurrency: number) => <T>(fn: () => Promise<T>) => Promise<T>;
  export default pLimit;
}

declare module "p-retry" {
  type Options = { retries?: number; factor?: number; minTimeout?: number; maxTimeout?: number };
  const pRetry: <T>(fn: () => Promise<T>, opts?: Options) => Promise<T>;
  export default pRetry;
}

declare module "@google/generative-ai" {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(opts: any): any;
  }
}
// --- dotenv 最小类型声明（用于本地未安装完整类型时兜底） ---
declare module "dotenv" {
  export interface DotenvConfigOptions {
    path?: string;
    encoding?: string;
    debug?: boolean;
    override?: boolean;
  }
  export interface DotenvConfigOutput {
    parsed?: Record<string, string>;
    error?: Error;
  }
  export function config(options?: DotenvConfigOptions): DotenvConfigOutput;
  const _default: { config: typeof config };
  export default _default;
}
// --- end dotenv shim ---