# 你画我猜 · Draw & Guess

免登录多人实时你画我猜:建房 → 准备 → 轮流作画 → 聊天猜词计分 → 结算排名。支持手机与电脑同房间游玩(画板 4:3 比例跨端一致)、房间语音通话(WebRTC)。

文档:[PRD](./docs/PRD.md) · [技术设计](./docs/TECH-DESIGN.md)

## 快速开始(直接玩)

```bash
# 仓库根目录
pnpm install
pnpm --filter @draw-guess/web build     # 构建前端产物
pnpm --filter @draw-guess/server start  # 启动游戏服务(端口 5310,监听 0.0.0.0)
```

打开 `http://localhost:5310` 即可;同一局域网内手机访问启动日志中打印的 `http://<LAN IP>:5310` 一起玩。

> 语音说明:浏览器仅在 HTTPS 或 localhost 下允许取麦克风。电脑上用 localhost 可直接开语音;手机经 `http://<LAN IP>` 访问时语音会降级提示(游戏其他功能不受影响),需要语音可为服务配置 HTTPS。

## 开发模式

```bash
pnpm --filter @draw-guess/server dev   # tsx watch,端口 5310
pnpm --filter @draw-guess/web dev      # Vite,端口 5311(/socket.io 代理至 5310)
```

## 测试与检查

```bash
pnpm --filter @draw-guess/server test        # vitest:34 个状态机单测 + 2 个真实 socket 集成测试
pnpm --filter @draw-guess/server typecheck
pnpm --filter @draw-guess/web typecheck
```

## 包结构

| 包 | 说明 |
|---|---|
| `@draw-guess/shared` | socket.io 事件协议、模型类型、常量(画板 800×600 逻辑面等) |
| `@draw-guess/server` | Node + socket.io + express:房间管理、服务端权威游戏状态机、词库、语音信令,生产模式托管 `web/dist` |
| `@draw-guess/web` | Vite + React 18 + zustand:首页/房间/游戏/结算,归一化坐标画板,WebRTC mesh 语音 |

## 玩法规则速览

- 房主建房(2~8 人、1~3 轮、猜词时长 30~180 秒默认 90、类型提示延迟 0~60 秒默认 20、候选词 3/4/5 个),其他玩家全部准备后开始。
- 每回合画者从候选词中选 1 个(15 秒超时自动选),可「换一批」刷新候选词一次;其余玩家聊天猜词。
- 猜中得 `max(10, 100×剩余时间占比)` 分,首猜 +20;画者每有一人猜中 +25。
- 猜词端开局仅显示字数,类型提示在配置秒数后显示,剩余时间 <40% 时揭示一个字;全员猜中提前结束回合。
- 已猜中者发言仅画者与已猜中者可见;画者消息含答案会被拦截。
- 断线保留 60 秒,同一浏览器刷新/重连自动恢复对局;游戏结束展示排名,房主可发起再来一局。
