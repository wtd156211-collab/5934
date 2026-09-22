# Trace Waterfall

单条分布式调用链（Trace）的瀑布图查看器。后端通过 Express API 提供
OpenTelemetry 风格的 Span 数据，前端用 React + TypeScript + SVG 渲染
层级瀑布图。

## 运行

```bash
npm install
npm run server   # 启动 Trace API（:4100），内存中由生成器产出真实 Trace 数据
npm run dev      # Vite 开发服务器（:5100，/api 代理到 :4100）
```

生产模式：

```bash
npm run build
npm run preview  # 静态资源 + /api 代理（:5100）
```

## 验证

```bash
npm test           # Vitest 单元/回归测试（树构建、异常降级、折叠等）
npm run typecheck  # TypeScript 严格检查
npm run build      # 生产构建
npm run verify:e2e # Playwright 端到端验证（需 server + preview 已启动）
```

注意：本环境（WSL 无 sudo）运行 e2e 需要为 Chromium 补充系统库，
已通过本地解压 `libnspr4`/`libnss3`/`libasound2` 到
`~/.local/chromium-libs` 并设置 `LD_LIBRARY_PATH` 解决。

## 架构

- `shared/trace.ts` — OTel 对齐的 Span/Trace 模型与错误、超时判定。
- `server/` — Express API：`GET /api/traces`、`GET /api/traces/:id`；
  `traceGenerator.ts` 在启动时生成串行、嵌套、并行、错误/超时、
  异常（缺失父 Span、时间反转、乱序）四类真实 Trace 数据。
- `src/lib/spanTree.ts` — 核心纯函数：Span 森林构建、非法时间钳制、
  孤儿降级、乱序排序、折叠展开扁平化、Span 数量上限（2000）。
- `src/components/` — Trace 列表、SVG 瀑布图（缩放/折叠/高亮）、
  Span 详情面板。

## 已知限制

- 单 Trace 渲染上限 2000 Span，超出截断并提示；未实现完整虚拟化。
- 缩放为按钮 + Ctrl/⌘+滚轮，未实现拖拽框选与平移。
- 后端为内存存储，重启后数据重新生成；未接入真实 Collector。
- 时间戳使用 number 存储纳秒值，超过 2^53 纳秒（约 104 天）的
  绝对时间会有精度损失，对本场景（相对时间轴）无影响。
