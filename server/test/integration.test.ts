import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import type {
  AckRes,
  ChatMsg,
  RoomState,
  Stroke,
  WordOption,
} from '@draw-guess/shared';
import { createGameServer, type GameServer } from '../src/app';

let server: GameServer;
let port: number;

class TC {
  states: RoomState[] = [];
  chats: ChatMsg[] = [];
  word: string | null = null;
  options: WordOption[] | null = null;
  strokes: Stroke[] = [];

  constructor(
    readonly socket: Socket,
    readonly playerId: string,
    readonly name: string,
  ) {
    socket.on('room:state', (s: RoomState) => this.states.push(s));
    socket.on('chat:msg', (m: ChatMsg) => this.chats.push(m));
    socket.on('game:word', (p: { word: string }) => (this.word = p.word));
    socket.on('game:wordOptions', (p: { words: WordOption[] }) => (this.options = p.words));
    socket.on('draw:stroke', (s: Stroke) => this.strokes.push(s));
  }

  static async connect(playerId: string, name: string): Promise<TC> {
    const socket = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const tc = new TC(socket, playerId, name);
    const res = await tc.emitAck('hello', { playerId, name });
    expect(res.ok).toBe(true);
    return tc;
  }

  get state(): RoomState | undefined {
    return this.states[this.states.length - 1];
  }

  emitAck<T = Record<never, never>>(event: string, payload?: unknown): Promise<AckRes<T>> {
    return new Promise((resolve) => {
      if (payload === undefined) {
        this.socket.emit(event, (res: AckRes<T>) => resolve(res));
      } else {
        this.socket.emit(event, payload, (res: AckRes<T>) => resolve(res));
      }
    });
  }

  waitState(pred: (s: RoomState) => boolean, timeoutMs = 10_000): Promise<RoomState> {
    const hit = this.state && pred(this.state) ? this.state : undefined;
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off('room:state', onState);
        reject(new Error(`waitState 超时;最后状态: ${JSON.stringify(this.state?.phase)}`));
      }, timeoutMs);
      const onState = (s: RoomState): void => {
        if (pred(s)) {
          clearTimeout(timer);
          this.socket.off('room:state', onState);
          resolve(s);
        }
      };
      this.socket.on('room:state', onState);
    });
  }

  async waitFor(pred: () => boolean, timeoutMs = 10_000, what = '条件'): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error(`等待${what}超时`);
      await sleep(30);
    }
  }

  close(): void {
    this.socket.disconnect();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = createGameServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  port = (server.httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  server.io.close();
  await new Promise<void>((resolve) => {
    server.httpServer.close(() => resolve());
  });
});

describe('三人完整对局(真实 socket)', () => {
  it('建房→加入→准备→开始→三回合→结算→再来一局', { timeout: 60_000 }, async () => {
    const c1 = await TC.connect('player-aaaa-0001', '安娜');
    const c2 = await TC.connect('player-bbbb-0002', '波仔');
    const c3 = await TC.connect('player-cccc-0003', '陈晨');
    const all = [c1, c2, c3];

    // 建房
    const created = await c1.emitAck<{ roomId: string }>('room:create', {
      config: { rounds: 1, drawSeconds: 60, maxPlayers: 4 },
    });
    expect(created.ok).toBe(true);
    const roomId = (created as { ok: true; roomId: string }).roomId;
    expect(roomId).toMatch(/^\d{6}$/);

    // 房间列表可见
    const list = await c2.emitAck<{ rooms: { id: string }[] }>('room:list');
    expect((list as { ok: true; rooms: { id: string }[] }).rooms.some((r) => r.id === roomId)).toBe(true);

    // 加入
    expect((await c2.emitAck('room:join', { roomId })).ok).toBe(true);
    expect((await c3.emitAck('room:join', { roomId })).ok).toBe(true);
    await c1.waitState((s) => s.players.length === 3);

    // 未全员准备时不能开始
    const early = await c1.emitAck('game:start');
    expect(early.ok).toBe(false);

    // 准备并开始
    expect((await c2.emitAck('room:ready', { ready: true })).ok).toBe(true);
    expect((await c3.emitAck('room:ready', { ready: true })).ok).toBe(true);
    expect((await c1.emitAck('game:start')).ok).toBe(true);

    // 依次三个回合
    for (let turn = 1; turn <= 3; turn++) {
      const choosing = await c1.waitState((s) => s.phase === 'choosing' && s.turnInRound === turn);
      const drawer = all.find((c) => c.playerId === choosing.drawerId)!;
      const guessers = all.filter((c) => c !== drawer);

      await drawer.waitFor(() => drawer.options !== null, 5000, '候选词');
      expect(drawer.options).toHaveLength(3);
      expect((await drawer.emitAck('game:chooseWord', { index: 0 })).ok).toBe(true);
      await drawer.waitFor(() => drawer.word !== null, 5000, '答案下发');
      const word = drawer.word!;

      // 画者画一笔,其他人应收到
      const strokeCountBefore = guessers.map((g) => g.strokes.length);
      drawer.socket.emit('draw:stroke', {
        id: `turn${turn}`,
        tool: 'pen',
        color: '#1e1e1e',
        width: 4,
        points: [0.1, 0.1, 0.5, 0.5],
      });
      await Promise.all(
        guessers.map((g, i) =>
          g.waitFor(() => g.strokes.length > strokeCountBefore[i], 5000, '笔画同步'),
        ),
      );

      if (turn === 1) {
        // 猜词端状态里不应有原词
        const gState = guessers[0].state!;
        expect(gState.wordHint).not.toContain(word[0]);

        // 第一个猜中者
        expect((await guessers[0].emitAck('chat:send', { text: word })).ok).toBe(true);
        await guessers[0].waitFor(() => guessers[0].word === word, 5000, '猜中下发原词');

        // 已猜中者发言:画者可见、未猜中者不可见
        const secret = '这是只有猜中的人能看到的话';
        expect((await guessers[0].emitAck('chat:send', { text: secret })).ok).toBe(true);
        await drawer.waitFor(() => drawer.chats.some((m) => m.text === secret), 5000, '画者可见');
        await sleep(300);
        expect(guessers[1].chats.some((m) => m.text === secret)).toBe(false);

        // 第二人猜中 → 全员猜中提前结束
        expect((await guessers[1].emitAck('chat:send', { text: word })).ok).toBe(true);
        const end = await c1.waitState((s) => s.phase === 'turnEnd');
        expect(end.turnResult!.reason).toBe('allGuessed');
        expect(end.turnResult!.word).toBe(word);
      } else {
        // 后续回合快速猜中推进
        for (const g of guessers) {
          expect((await g.emitAck('chat:send', { text: word })).ok).toBe(true);
        }
        await c1.waitState((s) => s.phase === 'turnEnd');
      }

      // 重置词记录,等待下一阶段
      all.forEach((c) => {
        c.word = null;
        c.options = null;
      });
    }

    // 结算
    const end = await c1.waitState((s) => s.phase === 'gameEnd');
    expect(end.ranking).toHaveLength(3);
    expect(end.ranking![0].score).toBeGreaterThanOrEqual(end.ranking![1].score);

    // 仅房主可再来一局
    expect((await c2.emitAck('game:again')).ok).toBe(false);
    expect((await c1.emitAck('game:again')).ok).toBe(true);
    const lobby = await c2.waitState((s) => s.phase === 'lobby');
    expect(lobby.players.every((p) => !p.ready)).toBe(true);

    all.forEach((c) => c.close());
  });

  it('ack 位被塞非函数时服务不崩溃且继续响应', { timeout: 15_000 }, async () => {
    const c = await TC.connect('player-evil-x001', '捣蛋鬼');
    // 恶意/非规范客户端:对象占据 ack 参数位
    (c.socket as { emit(ev: string, ...args: unknown[]): unknown }).emit('game:refreshWords', {});
    (c.socket as { emit(ev: string, ...args: unknown[]): unknown }).emit('game:start', {});
    (c.socket as { emit(ev: string, ...args: unknown[]): unknown }).emit('room:list', 42);
    await sleep(300);
    const res = await c.emitAck<{ rooms: unknown[] }>('room:list');
    expect(res.ok).toBe(true);
    c.close();
  });

  it('断线重连恢复对局(hello 自动重入)', { timeout: 30_000 }, async () => {
    const h = await TC.connect('player-recon-h01', '房主');
    const g = await TC.connect('player-recon-g02', '客人');
    const created = await h.emitAck<{ roomId: string }>('room:create', {
      config: { rounds: 1, drawSeconds: 60 },
    });
    const roomId = (created as { ok: true; roomId: string }).roomId;
    expect((await g.emitAck('room:join', { roomId })).ok).toBe(true);
    expect((await g.emitAck('room:ready', { ready: true })).ok).toBe(true);
    expect((await h.emitAck('game:start')).ok).toBe(true);
    await h.waitState((s) => s.phase === 'choosing');

    // 客人断线后用同一 playerId 重连
    g.close();
    await h.waitState((s) => s.players.find((p) => p.id === g.playerId)?.online === false);
    const g2 = await TC.connect('player-recon-g02', '客人');
    await g2.waitState((s) => s.phase !== 'lobby' && s.players.find((p) => p.id === g2.playerId)?.online === true);
    expect(g2.state!.id).toBe(roomId);

    h.close();
    g2.close();
  });
});
