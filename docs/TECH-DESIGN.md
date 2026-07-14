# Draw & Guess 技术设计文档(Tech Design)

> 版本:1.0 · 日期:2026-07-13 · 配套文档:[PRD.md](./PRD.md)

## 1. 方案选型

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. Vite+React 前端 + Node(socket.io)后端(monorepo 三包)** | 生产模式后端直接托管前端构建产物,单端口即玩;开发模式 Vite 代理 | ✅ 采用 |
| B. Next.js 全栈 | WebSocket 需自定义 server,失去 Next 部署优势,复杂度高 | ❌ |
| C. Cloudflare Workers + Durable Objects | 适合公网部署,但本地"直接开玩"与语音信令调试成本高 | ❌ |

- **实时通信**:socket.io(内建 room、自动重连、二进制支持),服务端权威。
- **语音**:WebRTC P2P full-mesh(≤8 人),socket.io 复用为信令通道,STUN 用公共服务器(局域网内 host candidate 直连即可)。
- **状态**:全内存(Map<roomId, Room>),不落库;进程即游戏服务器。
- **前端状态**:zustand(仓内已有使用先例)。

## 2. 包结构(pnpm workspace 新增成员)

```
apps/draw-guess/
├── docs/                 # PRD 与本文档
├── shared/               # @draw-guess/shared —— 协议与常量(纯 TS 源码包)
│   └── src/{protocol.ts,constants.ts,index.ts}
├── server/               # @draw-guess/server —— Node20 + socket.io + express
│   ├── src/{index.ts,roomManager.ts,room.ts,words.ts,wordBank.ts}
│   └── test/{room.test.ts,integration.test.ts}   # vitest
└── web/                  # @draw-guess/web —— Vite + React18 + zustand
    └── src/{main.tsx,App.tsx,store.ts,socket.ts,voice.ts,components/*,styles.css}
```

`pnpm-workspace.yaml` 追加 `apps/draw-guess/*`。React 用 18(与 @cta/web、low-code 一致,规避仓内 React19 类型提升问题;不依赖 antd,纯手写 CSS)。

- 端口:server **5310**(HTTP+WS,监听 0.0.0.0 便于手机访问);web dev **5311**(Vite,`/socket.io` 代理至 5310)。
- 生产:`pnpm --filter @draw-guess/web build` 后 server 用 express.static 托管 `web/dist`,手机与电脑同访 `http://<局域网IP>:5310`。
- server 运行采用 tsx(dev: `tsx watch`,start: `tsx`),不做 tsc emit;`typecheck` 用 `tsc --noEmit`。shared 以源码形式被 web(vite alias)与 server(tsconfig paths + tsx)直接消费。

## 3. 协议设计(shared/src/protocol.ts)

传输层:socket.io 事件。所有客户端→服务端请求用 ack 回调返回 `{ ok: true, ... } | { ok: false, error }`。

### 3.1 模型

```ts
Player   { id, name, seat, isHost, ready, online, score, guessedAt?: number|null }
RoomConfig { maxPlayers: 2..8, rounds: 1|2|3, drawSeconds: 30..180, categoryHintSeconds: 0..60, wordOptionCount: 3|4|5 }
RoomPhase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameEnd'
RoomState { id, phase, config, players[], round, turn, drawerId, wordHint(masked), timerEndsAt, turnResult?, ranking? }
Stroke   { id, tool: 'pen'|'eraser', color, width, points: number[] /* x0,y0,x1,y1… 归一化0..1 */ }
ChatMsg  { id, kind: 'chat'|'system'|'correct'|'close', playerId?, name?, text, ts }
```

### 3.2 事件表

| 方向 | 事件 | 载荷 → 响应 |
|---|---|---|
| C→S | `hello` | `{playerId, name}` → 恢复会话(若在房间中直接重入) |
| C→S | `room:create` | `{name, config}` → `{roomId}` |
| C→S | `room:join` / `room:leave` | `{roomId}` |
| C→S | `room:list` | → `{rooms: RoomSummary[]}` |
| C→S | `room:ready` | `{ready: boolean}` |
| C→S | `game:start` | (房主) |
| C→S | `game:chooseWord` | `{index: 0..wordOptionCount-1}` |
| C→S | `game:refreshWords` | 画者刷新候选词(每回合限 1 次,不重置选词倒计时),成功后服务端重发 `game:wordOptions` |
| C→S | `game:again` | (结算页回到 lobby) |
| C→S | `draw:stroke` | Stroke(整笔) / `draw:point` 增量 `{strokeId, points}` |
| C→S | `draw:clear` | — |
| C→S | `chat:send` | `{text}` |
| S→C | `room:state` | RoomState(全量,入房/阶段切换/成员变化时) |
| S→C | `game:wordOptions` | `{words: {text,hint}[], refreshLeft}`(仅画者) |
| S→C | `game:word` | `{word}`(仅画者与已猜中者) |
| S→C | `draw:stroke`/`draw:point`/`draw:clear`/`draw:sync` | 笔画广播;sync 为全量笔画(重连) |
| S→C | `chat:msg` | ChatMsg(按可见性定向发送) |
| C↔S | `voice:join`/`voice:leave`/`voice:mute` | 语音房状态;S→C `voice:peers` `{peers:[{playerId, muted}]}` |
| C↔S | `voice:signal` | `{to, data}` → 转发 `{from, data}`(SDP/ICE) |

### 3.3 关键规则实现

- **计时**:服务端 `setTimeout` 驱动阶段迁移;RoomState 带 `timerEndsAt`(epoch ms),前端本地渲染倒计时,不依赖 tick 广播。Room 类的时钟与定时器可注入(测试用假定时器)。
- **判词**:去空白、小写化后全等 → 猜中;非全等但互为包含 → "接近"私信。猜中后该玩家消息只发给画者+已猜中者。
- **提示**:`wordHint` 服务端按阶段计算掩码(字数 + 时间<40% 时揭示 1 字),不向猜词端下发原词;`wordCategory` 由独立 categoryTimer 在开局 `categoryHintSeconds` 秒后置位下发(0=立即,≥drawSeconds 则整回合不显示)。
- **候选词**:每回合按 `wordOptionCount` 抽样;画者可 `game:refreshWords` 刷新(每回合 1 次),刷新排除本回合已展示过的词(`offeredWords`),超时自动选取当前列表第一个。
- **重连**:playerId(UUID,localStorage)为身份键;断线保留 60s(定时器),`hello` 匹配后恢复 socket 绑定并回放 `room:state` + `draw:sync` + 词信息。
- **画板一致性**:逻辑面 800×600;客户端将指针坐标除以画布 CSS 尺寸得 0..1 归一坐标;渲染端乘以自身 canvas 尺寸(devicePixelRatio 缩放)。线宽以逻辑像素定义,按缩放比例放大。

## 4. 服务端结构

- `index.ts`:express(静态 + `/healthz`) + socket.io 装配;`connection` → 绑定各事件到 RoomManager。
- `roomManager.ts`:roomId 生成(6 位数字)、公开房列表、玩家→房间索引、断线宽限。
- `room.ts`:单房间状态机(核心,纯逻辑可测):
  `lobby --start--> choosing --choose/timeout--> drawing --allGuessed/timeout/drawerLeft--> turnEnd --next--> choosing | gameEnd --again--> lobby`
  内含计分、回合推进、可见性分发(通过注入的 `emitter` 接口,便于单测断言)。
- `words.ts` + `wordBank.ts`:≥120 个中文词条 `{text, hint}`,按房间不重复抽样。

## 5. 前端结构

- 单页三态路由(zustand `phase` 驱动):Home → Room(lobby)→ Game → GameEnd(Room 复用)。
- `socket.ts`:单例 socket + 事件→store 绑定;`voice.ts`:WebRTC mesh 管理(peers Map、getUserMedia、信令回调、audio 元素挂载)。
- 画板 `CanvasBoard.tsx`:两层 canvas(已完成笔画层 + 当前笔画层可不分层,直接单层增量绘制 + 全量重绘 on resize/sync);pointer events 统一鼠标/触摸;RAF 批量发送增量点(~30ms/批)。
- 移动端布局:竖屏时画板占顶端(宽度 100%,4:3),下方词条/工具栏/聊天;桌面三栏(玩家|画板|聊天)。

## 6. 测试策略

1. **单元测试(vitest)**:Room 状态机 —— 准备/开始约束、选词超时、猜中计分(首猜加成/时间衰减)、全猜中提前结束、画者掉线、重连恢复、排名正确性。用注入假时钟,不真等。
2. **集成测试(vitest + socket.io-client)**:真实起 server(随机端口),3 客户端跑完整局(建房→准备→开始→选词→画→猜→结算),断言事件序列与可见性(未猜中者收不到已猜中者聊天)。
3. **端到端手测(浏览器)**:桌面 + 手机 viewport 双窗口实玩,验证画板比例、触摸、语音降级提示。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 手机经 `http://<LAN IP>` 访问时 getUserMedia 被浏览器禁用 | 语音模块检测 `window.isSecureContext`,降级提示;文档说明可用 localhost/HTTPS |
| socket.io 与 React 严格模式双挂载 | socket 单例延迟连接;effect 清理只解绑监听 |
| 多设备 canvas 分辨率差异导致线条粗细不一 | 线宽按逻辑坐标定义,渲染端乘缩放系数 |
| 房间泄漏 | 房间空置即销毁;断线宽限定时器统一清理 |
