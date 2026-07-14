import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMsg, RoomConfig, RoomState, TurnRecord, WordOption } from '@draw-guess/shared';
import { GameError, Room } from '../src/room';
import { sanitizeConfig } from '../src/roomManager';
import { FakeClock, FakeIO } from './helpers';

const CONFIG: RoomConfig = {
  mode: 'classic',
  maxPlayers: 8,
  rounds: 1,
  drawSeconds: 80,
  categoryHintSeconds: 20,
  wordOptionCount: 3,
};

type WordOptionsPayload = { words: WordOption[]; refreshLeft: number };

let clock: FakeClock;
let io: FakeIO;
let removed: string[];
let emptied: boolean;

function makeRoom(config = CONFIG): Room {
  removed = [];
  emptied = false;
  return new Room(
    '123456',
    { ...config },
    io,
    {
      onPlayerRemoved: (id) => removed.push(id),
      onEmpty: () => {
        emptied = true;
      },
    },
    clock,
    () => 0, // 确定性:总是取候选列表第一个
  );
}

/** 建 3 人房(A 房主)并开始游戏,返回房间(处于 choosing,画者 A) */
function startedRoom(): Room {
  const room = makeRoom();
  room.addPlayer('A', '安娜');
  room.addPlayer('B', '波仔');
  room.addPlayer('C', '陈晨');
  room.setReady('B', true);
  room.setReady('C', true);
  room.startGame('A');
  return room;
}

function drawingRoom(): Room {
  const room = startedRoom();
  room.chooseWord('A', 0);
  return room;
}

function wordOf(room: Room): string {
  void room;
  const sent = io.last('A', 'game:word');
  return (sent!.args[0] as { word: string }).word;
}

beforeEach(() => {
  clock = new FakeClock();
  io = new FakeIO();
});

describe('房间与准备', () => {
  it('第一个进房者是房主,人满拒绝加入', () => {
    const room = makeRoom({ ...CONFIG, maxPlayers: 2 });
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    expect(io.lastState('A')!.hostId).toBe('A');
    expect(() => room.addPlayer('C', '陈晨')).toThrow('房间已满');
  });

  it('房主无需准备;非房主可准备/取消', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    expect(() => room.setReady('A', true)).toThrow('房主无需准备');
    room.setReady('B', true);
    expect(io.lastState('A')!.players.find((p) => p.id === 'B')!.ready).toBe(true);
    room.setReady('B', false);
    expect(io.lastState('A')!.players.find((p) => p.id === 'B')!.ready).toBe(false);
  });

  it('开始约束:仅房主、人数>=2、其他人全部已准备', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    expect(() => room.startGame('A')).toThrow('至少需要');
    room.addPlayer('B', '波仔');
    expect(() => room.startGame('B')).toThrow('只有房主');
    expect(() => room.startGame('A')).toThrow('还有玩家未准备');
    room.setReady('B', true);
    room.startGame('A');
    expect(room.phase).toBe('choosing');
  });

  it('游戏进行中不可加入', () => {
    const room = drawingRoom();
    expect(() => room.addPlayer('D', '丁丁')).toThrow('游戏进行中');
  });

  it('房主离开后房主移交给最早进房的玩家', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.addPlayer('C', '陈晨');
    room.leave('A');
    expect(io.lastState('B')!.hostId).toBe('B');
    expect(removed).toContain('A');
  });

  it('房间空了触发销毁', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.leave('A');
    expect(emptied).toBe(true);
  });
});

describe('选词阶段', () => {
  it('开始后进入 choosing,仅画者收到候选词', () => {
    startedRoom();
    const state = io.lastState('B')!;
    expect(state.phase).toBe('choosing');
    expect(state.drawerId).toBe('A');
    expect(io.of('A', 'game:wordOptions')).toHaveLength(1);
    expect(io.of('B', 'game:wordOptions')).toHaveLength(0);
    const words = io.last('A', 'game:wordOptions')!.args[0] as { words: WordOption[] };
    expect(words.words).toHaveLength(3);
  });

  it('非画者不能选词;选词后进入 drawing 且画者收到原词', () => {
    const room = startedRoom();
    expect(() => room.chooseWord('B', 0)).toThrow('只有画者');
    room.chooseWord('A', 1);
    expect(room.phase).toBe('drawing');
    expect(io.of('A', 'game:word')).toHaveLength(1);
    expect(io.of('B', 'game:word')).toHaveLength(0);
  });

  it('选词超时自动选第一个', () => {
    startedRoom();
    clock.advance(15_000);
    const state = io.lastState('B')!;
    expect(state.phase).toBe('drawing');
    expect(state.wordHint).toBeTruthy();
  });

  it('猜词端开局仅见字数掩码,类型提示到配置秒数后才显示', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    let state = io.lastState('B')!;
    expect(state.wordHint).toBe('＿'.repeat([...word].length));
    expect(state.wordCategory).toBeNull();
    clock.advance(19_999);
    expect(io.lastState('B')!.wordCategory).toBeNull();
    clock.advance(1);
    state = io.lastState('B')!;
    expect(state.wordCategory).toBeTruthy();
  });

  it('categoryHintSeconds=0 时类型提示立即显示', () => {
    const room = makeRoom({ ...CONFIG, categoryHintSeconds: 0 });
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.setReady('B', true);
    room.startGame('A');
    room.chooseWord('A', 0);
    expect(io.lastState('B')!.wordCategory).toBeTruthy();
  });

  it('回合提前结束后 categoryTimer 被清理,下一回合类型提示不提前泄露', () => {
    // T=0 进入 drawing,categoryTimer 排在 T+20s
    const room = drawingRoom();
    const word = wordOf(room);
    room.chat('B', word);
    room.chat('C', word); // T=0 全员猜中 → turnEnd(clearTimers 应清掉 categoryTimer)
    clock.advance(5_000); // T=5s 进入 turn2 choosing(B 画)
    clock.advance(15_000); // T=20s:turn2 选词超时进入 drawing;若残留定时器此刻触发会误置 categoryRevealed
    expect(io.lastState('A')!.phase).toBe('drawing');
    expect(io.lastState('A')!.wordCategory).toBeNull();
    // turn2 的类型提示应在自己的 drawing 开始(T=20s)后 20 秒即 T=40s 才显示
    clock.advance(19_999);
    expect(io.lastState('A')!.wordCategory).toBeNull();
    clock.advance(1);
    expect(io.lastState('A')!.wordCategory).toBeTruthy();
  });

  it('选词携带的词文本与当前列表不符时拒绝(防"换一批"竞态误选)', () => {
    const room = startedRoom();
    const first = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    room.refreshWords('A'); // 服务端列表已换新
    expect(() => room.chooseWord('A', 0, first.words[0].text)).toThrow('候选词已更新');
    expect(room.phase).toBe('choosing'); // 未误入 drawing
    const second = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    room.chooseWord('A', 0, second.words[0].text);
    expect(room.phase).toBe('drawing');
  });

  it('类型提示延迟超过作画时长时整回合不显示', () => {
    const room = makeRoom({ ...CONFIG, drawSeconds: 30, categoryHintSeconds: 60 });
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.setReady('B', true);
    room.startGame('A');
    room.chooseWord('A', 0);
    clock.advance(29_000);
    expect(io.lastState('B')!.wordCategory).toBeNull();
  });
});

describe('候选词刷新', () => {
  it('刷新给出与上一批不重复的候选词,次数用完后拒绝', () => {
    const room = startedRoom();
    const first = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    expect(first.refreshLeft).toBe(1);
    expect(first.words).toHaveLength(3);

    room.refreshWords('A');
    const second = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    expect(second.refreshLeft).toBe(0);
    const firstTexts = new Set(first.words.map((w) => w.text));
    expect(second.words.every((w) => !firstTexts.has(w.text))).toBe(true);

    expect(() => room.refreshWords('A')).toThrow('刷新次数已用完');
  });

  it('仅画者且仅选词阶段可刷新', () => {
    const room = startedRoom();
    expect(() => room.refreshWords('B')).toThrow('只有画者');
    room.chooseWord('A', 0);
    expect(() => room.refreshWords('A')).toThrow('当前不在选词阶段');
  });

  it('刷新不重置选词倒计时,超时自动选新列表第一个', () => {
    const room = startedRoom();
    const before = io.lastState('A')!.timerEndsAt;
    clock.advance(10_000);
    room.refreshWords('A');
    expect(io.lastState('A')!.timerEndsAt).toBe(before);
    const second = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    clock.advance(5_000); // 选词 15 秒到点
    expect(room.phase).toBe('drawing');
    expect(wordOf(room)).toBe(second.words[0].text);
  });

  it('候选词数量按配置下发', () => {
    const room = makeRoom({ ...CONFIG, wordOptionCount: 5 });
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.setReady('B', true);
    room.startGame('A');
    const opts = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    expect(opts.words).toHaveLength(5);
  });

  it('画者顶号重连(rejoin)补发候选词与剩余刷新次数', () => {
    const room = startedRoom();
    room.refreshWords('A');
    io.clear();
    room.rejoin('A'); // hello 重连路径(如刷新页面),不经过掉线宽限
    const opts = io.last('A', 'game:wordOptions')!.args[0] as WordOptionsPayload;
    expect(opts.refreshLeft).toBe(0);
    expect(opts.words).toHaveLength(3);
  });
});

describe('配置校验', () => {
  it('缺省与非法值取默认', () => {
    expect(sanitizeConfig({})).toEqual({
      mode: 'classic',
      maxPlayers: 8,
      rounds: 2,
      drawSeconds: 90,
      categoryHintSeconds: 20,
      wordOptionCount: 3,
    });
    expect(sanitizeConfig(undefined).drawSeconds).toBe(90);
    expect(sanitizeConfig({ drawSeconds: Number.NaN }).drawSeconds).toBe(90);
  });

  it('时长与类型提示延迟按范围钳制到整数秒', () => {
    expect(sanitizeConfig({ drawSeconds: 10 }).drawSeconds).toBe(30);
    expect(sanitizeConfig({ drawSeconds: 999 }).drawSeconds).toBe(180);
    expect(sanitizeConfig({ drawSeconds: 95.4 }).drawSeconds).toBe(95);
    expect(sanitizeConfig({ categoryHintSeconds: -5 }).categoryHintSeconds).toBe(0);
    expect(sanitizeConfig({ categoryHintSeconds: 120 }).categoryHintSeconds).toBe(60);
    expect(sanitizeConfig({ wordOptionCount: 7 }).wordOptionCount).toBe(3);
    expect(sanitizeConfig({ wordOptionCount: 5 }).wordOptionCount).toBe(5);
  });
});

describe('猜词与计分', () => {
  it('立即猜中:100 分 + 首猜 20;画者 +25', () => {
    const room = drawingRoom();
    room.chat('B', wordOf(room));
    const state = io.lastState('C')!;
    expect(state.players.find((p) => p.id === 'B')!.score).toBe(120);
    expect(state.players.find((p) => p.id === 'A')!.score).toBe(25);
    expect(state.players.find((p) => p.id === 'B')!.guessed).toBe(true);
    // 猜中者收到原词与私信;答案不通过公共聊天泄露
    expect(io.of('B', 'game:word')).toHaveLength(1);
    const cChats = io.of('C', 'chat:msg').map((e) => e.args[0] as ChatMsg);
    expect(cChats.some((m) => m.text.includes(wordOf(room)))).toBe(false);
    expect(cChats.some((m) => m.kind === 'system' && m.text.includes('猜对了'))).toBe(true);
  });

  it('时间过半猜中得分衰减,非首猜无加成', () => {
    const room = drawingRoom();
    room.chat('B', wordOf(room));
    clock.advance(40_000); // 剩 40/80
    room.chat('C', wordOf(room));
    const state = io.lastState('A')!;
    expect(state.players.find((p) => p.id === 'C')!.score).toBe(50);
  });

  it('全员猜中提前结束回合,turnResult 记录各家得分', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    room.chat('B', word);
    room.chat('C', word);
    expect(room.phase).toBe('turnEnd');
    const state = io.lastState('B')!;
    expect(state.turnResult!.reason).toBe('allGuessed');
    expect(state.turnResult!.word).toBe(word);
    expect(state.turnResult!.gains['A']).toBe(50);
    expect(state.turnResult!.gains['B']).toBe(120);
    expect(state.turnResult!.gains['C']).toBe(100); // 同刻猜中,无衰减,无首猜加成
  });

  it('接近的猜测得到私信提示,错误猜测公开显示', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    room.chat('B', word.slice(0, 1)); // 是答案子串 → 接近
    const closeMsgs = io.of('B', 'chat:msg').map((e) => e.args[0] as ChatMsg);
    expect(closeMsgs.some((m) => m.kind === 'close')).toBe(true);
    io.clear();
    room.chat('B', '完全不沾边的词');
    const cChats = io.of('C', 'chat:msg').map((e) => e.args[0] as ChatMsg);
    expect(cChats.some((m) => m.kind === 'chat' && m.text === '完全不沾边的词')).toBe(true);
  });

  it('已猜中者的发言仅画者与已猜中者可见', () => {
    const room = drawingRoom();
    room.chat('B', wordOf(room));
    io.clear();
    room.chat('B', '这词也太好画了');
    expect(io.of('A', 'chat:msg')).toHaveLength(1);
    expect(io.of('B', 'chat:msg')).toHaveLength(1);
    expect(io.of('C', 'chat:msg')).toHaveLength(0);
  });

  it('画者不能发送包含答案的消息', () => {
    const room = drawingRoom();
    expect(() => room.chat('A', `答案是${wordOf(room)}`)).toThrow('不能透露答案');
  });

  it('作画超时结束回合', () => {
    const room = drawingRoom();
    clock.advance(80_000);
    expect(room.phase).toBe('turnEnd');
    expect(io.lastState('A')!.turnResult!.reason).toBe('timeout');
  });

  it('剩余时间低于 40% 时揭示一个字', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    clock.advance(80_000 * 0.6 + 1);
    const hint = io.lastState('B')!.wordHint!;
    expect([...hint].some((c) => c !== '＿')).toBe(true);
    expect([...hint].length).toBe([...word].length);
  });
});

describe('回合推进与结算', () => {
  it('轮流作画,单轮 3 人共 3 回合后结算', () => {
    const room = drawingRoom(); // 画者 A
    clock.advance(80_000); // 超时 → turnEnd
    clock.advance(5_000); // → B 画
    expect(io.lastState('A')!.drawerId).toBe('B');
    expect(io.lastState('A')!.turnInRound).toBe(2);
    clock.advance(15_000 + 80_000 + 5_000); // B 选词超时+作画超时+结算 → C 画
    expect(io.lastState('A')!.drawerId).toBe('C');
    clock.advance(15_000 + 80_000 + 5_000); // C 回合走完 → 游戏结束
    expect(room.phase).toBe('gameEnd');
    expect(io.lastState('A')!.ranking).toHaveLength(3);
  });

  it('两轮时每人画两次', () => {
    const room = makeRoom({ ...CONFIG, rounds: 2 });
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.setReady('B', true);
    room.startGame('A');
    // 每回合最长 15+80+5=100s,2 轮 4 回合
    clock.advance(4 * 100_000);
    expect(room.phase).toBe('gameEnd');
    expect(io.lastState('A')!.round).toBe(2);
  });

  it('排名按分数降序,同分同名次', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    room.chat('B', word);
    room.chat('C', word); // B:120 C:100 A:50
    clock.advance(5_000); // B 画
    clock.advance(15_000 + 80_000 + 5_000); // 无人猜 → C 画
    clock.advance(15_000 + 80_000 + 5_000); // 无人猜 → 结束
    const ranking = io.lastState('A')!.ranking!;
    expect(ranking.map((r) => r.playerId)).toEqual(['B', 'C', 'A']);
    expect(ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('再来一局:仅房主可发起,回到 lobby 且准备状态重置', () => {
    const room = drawingRoom();
    clock.advance(3 * 100_000 + 1000);
    expect(room.phase).toBe('gameEnd');
    expect(() => room.playAgain('B')).toThrow('只有房主');
    room.playAgain('A');
    expect(room.phase).toBe('lobby');
    const state = io.lastState('B')!;
    expect(state.players.every((p) => !p.ready)).toBe(true);
  });
});

describe('断线与重连', () => {
  it('对局中掉线保留 60 秒,重连恢复画面与身份', () => {
    const room = drawingRoom();
    room.chat('B', wordOf(room)); // B 先得分
    room.addStroke('A', { id: 's1', tool: 'pen', color: '#000', width: 4, points: [0.1, 0.1, 0.2, 0.2] });
    room.onDisconnect('B');
    expect(io.lastState('A')!.players.find((p) => p.id === 'B')!.online).toBe(false);
    io.clear();
    clock.advance(30_000);
    room.rejoin('B');
    const state = io.lastState('B')!;
    expect(state.players.find((p) => p.id === 'B')!.online).toBe(true);
    expect(state.players.find((p) => p.id === 'B')!.score).toBe(120);
    const sync = io.last('B', 'draw:sync')!.args[0] as { strokes: unknown[] };
    expect(sync.strokes).toHaveLength(1);
    expect(io.of('B', 'game:word')).toHaveLength(1); // 已猜中者重连补发原词
  });

  it('掉线超过宽限期被移除', () => {
    const room = drawingRoom();
    room.onDisconnect('B');
    clock.advance(60_000);
    expect(room.hasPlayer('B')).toBe(false);
    expect(removed).toContain('B');
  });

  it('画者掉线立即结束回合,游戏继续', () => {
    const room = drawingRoom();
    room.onDisconnect('A');
    expect(room.phase).toBe('turnEnd');
    expect(io.lastState('B')!.turnResult!.reason).toBe('drawerLeft');
    clock.advance(5_000);
    expect(io.lastState('B')!.drawerId).toBe('B');
  });

  it('lobby 掉线直接移除', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.onDisconnect('B');
    expect(room.hasPlayer('B')).toBe(false);
  });

  it('人数不足 2 时游戏终止回到 lobby', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.setReady('B', true);
    room.startGame('A');
    room.chooseWord('A', 0);
    room.leave('B');
    expect(room.phase).toBe('lobby');
  });

  it('猜词者掉线后其余人全猜中即提前结束', () => {
    const room = drawingRoom();
    room.onDisconnect('C');
    room.chat('B', wordOf(room));
    expect(room.phase).toBe('turnEnd');
    expect(io.lastState('B')!.turnResult!.reason).toBe('allGuessed');
  });
});

describe('画板', () => {
  it('仅画者在 drawing 阶段可画;笔画广播给其他人', () => {
    const room = drawingRoom();
    io.clear();
    room.addStroke('B', { id: 'x', tool: 'pen', color: '#000', width: 4, points: [0, 0] });
    expect(io.of('C', 'draw:stroke')).toHaveLength(0);
    room.addStroke('A', { id: 's1', tool: 'pen', color: '#000', width: 4, points: [0.5, 0.5] });
    room.addPoints('A', 's1', [0.6, 0.6]);
    expect(io.of('B', 'draw:stroke')).toHaveLength(1);
    expect(io.of('B', 'draw:point')).toHaveLength(1);
    expect(io.of('A', 'draw:stroke')).toHaveLength(0); // 不回显给画者
  });

  it('清空画板后重连同步为空', () => {
    const room = drawingRoom();
    room.addStroke('A', { id: 's1', tool: 'pen', color: '#000', width: 4, points: [0.5, 0.5] });
    room.clearCanvas('A');
    room.onDisconnect('B');
    io.clear();
    room.rejoin('B');
    const sync = io.last('B', 'draw:sync')!.args[0] as { strokes: unknown[] };
    expect(sync.strokes).toHaveLength(0);
  });

  it('坐标越界会被钳制到 0..1', () => {
    const room = drawingRoom();
    room.addStroke('A', { id: 's1', tool: 'pen', color: '#000', width: 4, points: [-1, 2, 0.5, 0.5] });
    const stroke = io.last('B', 'draw:stroke')!.args[0] as { points: number[] };
    expect(stroke.points).toEqual([0, 1, 0.5, 0.5]);
  });
});

describe('语音成员管理', () => {
  it('加入/静音/离开广播 voice:peers', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    room.addPlayer('B', '波仔');
    room.voiceJoin('A');
    let peers = io.last('B', 'voice:peers')!.args[0] as { peers: { playerId: string; muted: boolean }[] };
    expect(peers.peers).toEqual([{ playerId: 'A', muted: false }]);
    room.voiceMute('A', true);
    peers = io.last('B', 'voice:peers')!.args[0] as { peers: { playerId: string; muted: boolean }[] };
    expect(peers.peers[0].muted).toBe(true);
    room.voiceLeave('A');
    peers = io.last('B', 'voice:peers')!.args[0] as { peers: { playerId: string; muted: boolean }[] };
    expect(peers.peers).toHaveLength(0);
  });
});

describe('异常输入', () => {
  it('空消息与不在房间的玩家聊天被拒绝', () => {
    const room = makeRoom();
    room.addPlayer('A', '安娜');
    expect(() => room.chat('A', '   ')).toThrow('消息不能为空');
    expect(() => room.chat('Z', '你好')).toThrow(GameError);
  });

  it('turnEnd 阶段的状态包含即将展示的答案', () => {
    const room = drawingRoom();
    const word = wordOf(room);
    clock.advance(80_000);
    const state = io.lastState('C')! as RoomState;
    expect(state.turnResult!.word).toBe(word);
  });
});

describe('结算画廊', () => {
  it('整局结束后下发每回合存档(画者/词/笔画/猜中者)', () => {
    const room = startedRoom(); // 3 人,画者 A,choosing
    room.chooseWord('A', 0); // → drawing
    const word = wordOf(room);
    room.addStroke('A', {
      id: 's1',
      tool: 'pen',
      color: '#000',
      width: 4,
      points: [0.1, 0.1, 0.2, 0.2],
    });
    room.chat('B', word); // B 猜中,C 未猜
    clock.advance(80_000); // turn1 超时 → turnEnd
    clock.advance(5_000); // → turn2(B 画)choosing
    clock.advance(15_000 + 80_000 + 5_000); // turn2 走完 → turn3(C 画)
    clock.advance(15_000 + 80_000 + 5_000); // turn3 走完 → gameEnd
    expect(room.phase).toBe('gameEnd');

    const gallery = io.last('A', 'game:gallery')?.args[0] as { turns: TurnRecord[] } | undefined;
    expect(gallery).toBeTruthy();
    expect(gallery!.turns).toHaveLength(3);

    const t1 = gallery!.turns[0];
    expect(t1.round).toBe(1);
    expect(t1.turnInRound).toBe(1);
    expect(t1.drawerId).toBe('A');
    expect(t1.drawerName).toBe('安娜');
    expect(t1.word).toBe(word);
    expect(t1.strokes).toHaveLength(1);
    expect(t1.strokes[0].id).toBe('s1');
    expect(t1.correctGuessers.map((g) => g.playerId)).toContain('B');
    expect(t1.correctGuessers.find((g) => g.playerId === 'B')!.gain).toBeGreaterThan(0);
    // 未猜中的 C 不在名单
    expect(t1.correctGuessers.map((g) => g.playerId)).not.toContain('C');
  });

  it('重连到 gameEnd 阶段补发画廊', () => {
    const room = startedRoom();
    room.chooseWord('A', 0);
    clock.advance(3 * 100_000 + 1000); // 走到 gameEnd
    expect(room.phase).toBe('gameEnd');
    room.onDisconnect('B');
    io.clear();
    room.rejoin('B');
    expect(io.of('B', 'game:gallery')).toHaveLength(1);
  });

  it('后一局的画廊不含上一局的回合', () => {
    const room = startedRoom();
    room.chooseWord('A', 0);
    clock.advance(3 * 100_000 + 1000);
    expect(room.phase).toBe('gameEnd');
    room.playAgain('A'); // 回 lobby
    room.setReady('B', true);
    room.setReady('C', true);
    room.startGame('A');
    room.chooseWord('A', 0);
    clock.advance(3 * 100_000 + 1000);
    const gallery = io.last('A', 'game:gallery')!.args[0] as { turns: TurnRecord[] };
    expect(gallery.turns).toHaveLength(3); // 只含本局 3 回合
  });
});

describe('接龙模式', () => {
  function relayRoom(n = 4): Room {
    const room = makeRoom({ ...CONFIG, mode: 'relay', maxPlayers: 8, drawSeconds: 60 });
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n);
    const names = ['安', '波', '陈', '丁', '鄂', '冯'].slice(0, n);
    ids.forEach((id, i) => room.addPlayer(id, names[i]));
    ids.slice(1).forEach((id) => room.setReady(id, true));
    room.startGame('A');
    return room;
  }
  const seedOf = (): string => (io.last('A', 'relay:task')!.args[0] as { prompt: string }).prompt;

  it('不足 4 人无法开始接龙', () => {
    const room = makeRoom({ ...CONFIG, mode: 'relay' });
    room.addPlayer('A', '安');
    room.addPlayer('B', '波');
    room.addPlayer('C', '陈');
    room.setReady('B', true);
    room.setReady('C', true);
    expect(() => room.startGame('A')).toThrow('至少需要 4');
  });

  it('开局第一位作画并收到原始词;其余人只见进度、收不到画', () => {
    const room = relayRoom(4);
    expect(room.phase).toBe('relayDraw');
    const task = io.last('A', 'relay:task')!.args[0] as { kind: string; prompt?: string };
    expect(task.kind).toBe('draw');
    expect((task.prompt ?? '').length).toBeGreaterThan(0);
    const st = io.lastState('B')!;
    expect(st.relay).toEqual({
      step: 1,
      totalSteps: 4,
      kind: 'draw',
      activeId: 'A',
      activeName: '安',
    });
    io.clear();
    room.addStroke('A', {
      id: 's1',
      tool: 'pen',
      color: '#000',
      width: 4,
      points: [0.1, 0.1, 0.3, 0.3],
    });
    expect(io.of('B', 'draw:stroke')).toHaveLength(0); // 私密,不广播
  });

  it('作画→猜词→作画 依次推进,猜词者看到上一环的画,下一作画者拿到该猜词', () => {
    const room = relayRoom(4);
    room.addStroke('A', {
      id: 's1',
      tool: 'pen',
      color: '#000',
      width: 4,
      points: [0.2, 0.2, 0.4, 0.4],
    });
    room.relayDone('A');
    expect(room.phase).toBe('relayGuess');
    expect(io.lastState('C')!.relay!.activeId).toBe('B');
    const bTask = io.last('B', 'relay:task')!.args[0] as { kind: string; strokes?: unknown[] };
    expect(bTask.kind).toBe('guess');
    expect(bTask.strokes).toHaveLength(1);
    room.relayGuess('B', '香蕉');
    expect(room.phase).toBe('relayDraw');
    const cTask = io.last('C', 'relay:task')!.args[0] as { kind: string; prompt: string };
    expect(cTask).toEqual({ kind: 'draw', prompt: '香蕉' });
  });

  it('只有当前活动玩家能操作', () => {
    const room = relayRoom(4);
    expect(() => room.relayGuess('A', 'x')).toThrow('不在猜词环节');
    expect(() => room.relayDone('B')).toThrow('还没轮到你');
  });

  it('走完全链结算下发 recap;首尾一致则全员得分', () => {
    const room = relayRoom(4);
    const seed = seedOf();
    room.relayDone('A');
    room.relayGuess('B', seed);
    room.relayDone('C');
    room.relayGuess('D', seed);
    expect(room.phase).toBe('gameEnd');
    const recap = io.last('A', 'relay:recap')!.args[0] as {
      recap: { seed: string; links: unknown[]; success: boolean; finalGuess: string };
    };
    expect(recap.recap.seed).toBe(seed);
    expect(recap.recap.links).toHaveLength(4);
    expect(recap.recap.finalGuess).toBe(seed);
    expect(recap.recap.success).toBe(true);
    expect(io.lastState('A')!.ranking!.every((r) => r.score === 100)).toBe(true);
  });

  it('猜词/作画超时自动成环推进', () => {
    const room = relayRoom(4);
    clock.advance(60_000); // A 作画超时 → B 猜词
    expect(room.phase).toBe('relayGuess');
    clock.advance(45_000); // B 猜词超时 → C 作画
    expect(room.phase).toBe('relayDraw');
  });

  it('接龙结束再来一局清空接龙状态', () => {
    const room = relayRoom(4);
    room.relayDone('A');
    room.relayGuess('B', 'x');
    room.relayDone('C');
    room.relayGuess('D', 'y');
    expect(room.phase).toBe('gameEnd');
    room.playAgain('A');
    expect(room.phase).toBe('lobby');
    expect(io.lastState('A')!.relay).toBeNull();
  });

  it('等待者重连不会拿到当前作画者的画', () => {
    const room = relayRoom(4);
    room.addStroke('A', {
      id: 's1',
      tool: 'pen',
      color: '#000',
      width: 4,
      points: [0.1, 0.1, 0.2, 0.2],
    });
    room.onDisconnect('C');
    io.clear();
    room.rejoin('C');
    const sync = io.last('C', 'draw:sync')?.args[0] as { strokes: unknown[] } | undefined;
    expect(sync?.strokes ?? []).toHaveLength(0);
    expect(io.of('C', 'relay:task')).toHaveLength(0);
  });

  it('当前作画者掉线立即成环推进', () => {
    const room = relayRoom(4);
    room.onDisconnect('A'); // A 正在作画
    expect(room.phase).toBe('relayGuess'); // 直接进入 B 猜词
    expect(io.lastState('B')!.relay!.activeId).toBe('B');
  });
});
