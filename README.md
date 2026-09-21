# Distributed Trace Waterfall Viewer

单条分布式调用链（Trace）的瀑布图查看器。仓库初始状态没有任何已有可观测性模块，
因此本项目在最小集成范围内新建了一条完整数据链路，而非独立 Demo：

```
server/data/trace.json (OTLP JSON)
        │  served by Vite dev/preview middleware
        ▼
GET /api/trace ──► fetchTrace() ──► parseTrace() 归一化/校验 ──► buildLayout() 树形布局 ──► <Waterfall/> SVG
```

接入真实后端时，只需让后端在 `GET /api/trace?traceId=...` 返回 OTLP JSON
（`resourceSpans[].scopeSpans[].spans[]`）或扁平 span 数组，前端无需改动。

## 功能

- Span 层级、开始/结束时间、持续时长，按开始时间 DFS 排序（正确处理串行、嵌套、基本并行）。
- SVG 时间轴与时间条：缩放（Zoom +/−/Reset）、单个节点折叠/展开、全部折叠/展开。
- 错误 Span（OTel `status.code=ERROR` 或 `error` 属性）红色高亮；
  超时 Span（`timeout` 属性或 HTTP 504）橙色高亮；点击查看错误信息、事件与属性。
- 异常数据降级，不崩溃：
  - 缺失父 Span → 挂到 trace 根，行内 `orphan` 标记 + 顶部警告条 + 详情说明；
  - 乱序 Span → 按开始时间重排；
  - 非法时间范围（end < start）→ 时长钳为 0，渲染为可点击的菱形标记并提示；
  - 父链成环 → 断开为根并提示；重复 spanId、缺失 spanId → 跳过/忽略并提示；
  - Span 超过上限（默认 2000，`parseTrace(input, maxSpans)` 可调）→ 截断并提示。
- Span 详情面板：ID、父 ID、相对开始时间、绝对时间、时长、attributes、events、错误信息。

## 技术栈

- React 18 + TypeScript（strict），Vite 6，SVG 渲染，Vitest + Testing Library。
- 数据模型兼容 OpenTelemetry：纳秒时间戳（也接受毫秒）、OTLP 属性数组与普通 JSON 对象、
  OTLP/扁平/`{spans}` 三种包装格式。

## 命令

```bash
npm install
npm run dev        # http://localhost:5173 （/api/trace 中间件提供真实 JSON）
npm test           # 33 个回归测试
npm run typecheck  # tsc -b --noEmit
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产构建（同样提供 /api/trace）
```

## 限制（仓库基础为空所致）

- `/api/trace` 是 Vite 中间件读取本地 OTLP JSON 文件，不是真实采集后端；
  接后端时把该端点替换为真实查询接口即可。
- Span 上限 2000 行直接渲染，未做虚拟化/时间窗裁剪（任务范围内不需要）。
- 仓库原本没有日志/请求详情页面，因此未提供“跳转到已有日志详情”的入口。
- 未实现多 Trace 对比、泳道聚合、拖拽框选缩放。
