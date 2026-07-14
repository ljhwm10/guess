import {
  CHOOSE_SECONDS,
  DRAWER_POINT_PER_GUESS,
  FIRST_GUESS_BONUS,
  MIN_PLAYERS,
  RECONNECT_GRACE_MS,
  RELAY_GUESS_SECONDS,
  RELAY_MIN_PLAYERS,
  REVEAL_CHAR_RATIO,
  TURN_END_SECONDS,
  WORD_REFRESH_PER_TURN,
  CHAT_MAX_LEN,
  type ChatMsg,
  type RankingEntry,
  type RelayLink,
  type RelayProgress,
  type RelayRecap,
  type RoomConfig,
  type RoomPhase,
  type RoomState,
  type ServerToClientEvents,
  type Stroke,
  type TurnRecord,
  type TurnResult,
  type WordOption,
} from '@draw-guess/shared';
import { judgeGuess, maskWord, pickWords } from './words';

/** 接龙团队通关得分 */
const RELAY_SUCCESS_SCORE = 100;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** 房间对外发送通道,由 socket 层/测试实现 */
export interface RoomIO {
  send<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
}

interface PlayerInternal {
  id: string;
  name: string;
  ready: boolean;
  online: boolean;
  score: number;
  /** 当前回合猜中时刻,未猜中为 null */
  guessedAt: number | null;
  /** 当前回合得分 */
  turnGain: number;
  removeTimer: unknown | null;
  voiceJoined: boolean;
  voiceMuted: boolean;
}

export interface RoomHooks {
  /** 玩家被彻底移出房间(供 manager 维护索引) */
  onPlayerRemoved(playerId: string): void;
  /** 房间已空,应销毁 */
  onEmpty(): void;
}

export class GameError extends Error {}

const fail = (msg: string): never => {
  throw new GameError(msg);
};

export class Room {
  readonly id: string;
  readonly config: RoomConfig;
  phase: RoomPhase = 'lobby';

  private players = new Map<string, PlayerInternal>();
  private hostId = '';
  private round = 0;
  private drawQueue: string[] = [];
  private turnsPerRound = 0;
  private turnInRound = 0;
  private drawerId: string | null = null;
  private word: WordOption | null = null;
  private wordOptions: WordOption[] = [];
  private usedWords = new Set<string>();
  /** 本回合已向画者展示过的候选词(刷新时避免重复出现) */
  private offeredWords = new Set<string>();
  private wordRefreshLeft = 0;
  private revealedIndex: number | null = null;
  /** 类型提示是否已到点显示 */
  private categoryRevealed = false;
  private strokes: Stroke[] = [];
  private strokeById = new Map<string, Stroke>();
  private timerEndsAt: number | null = null;
  private phaseTimer: unknown | null = null;
  private revealTimer: unknown | null = null;
  private categoryTimer: unknown | null = null;
  private turnResult: TurnResult | null = null;
  private ranking: RankingEntry[] | null = null;
  /** 本局每回合存档,结算后作画廊/回顾 */
  private turnHistory: TurnRecord[] = [];
  // ---- 接龙(relay)状态 ----
  private relayOrder: string[] = [];
  private relaySeed = '';
  private relayLinks: RelayLink[] = [];
  /** 当前进行到第几步(0 起) */
  private relayStep = 0;
  private relayActiveId: string | null = null;
  private relayRecap: RelayRecap | null = null;
  private msgSeq = 0;
  private destroyed = false;

  constructor(
    id: string,
    config: RoomConfig,
    private io: RoomIO,
    private hooks: RoomHooks,
    private clock: Clock = systemClock,
    private rng: () => number = Math.random,
  ) {
    this.id = id;
    this.config = config;
  }

  // ---------- 查询 ----------

  get playerCount(): number {
    return this.players.size;
  }

  get hostName(): string {
    return this.players.get(this.hostId)?.name ?? '';
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getDrawerId(): string | null {
    return this.drawerId;
  }

  toState(): RoomState {
    return {
      id: this.id,
      phase: this.phase,
      config: this.config,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        ready: p.ready,
        online: p.online,
        score: p.score,
        guessed: p.guessedAt != null,
      })),
      round: this.round,
      totalRounds: this.config.rounds,
      turnInRound: this.turnInRound,
      turnsPerRound: this.turnsPerRound,
      drawerId: this.drawerId,
      wordHint:
        this.phase === 'drawing' && this.word ? maskWord(this.word.text, this.revealedIndex) : null,
      wordCategory:
        this.phase === 'drawing' && this.categoryRevealed ? this.word?.hint ?? null : null,
      timerEndsAt: this.timerEndsAt,
      turnResult: this.turnResult,
      ranking: this.ranking,
      relay: this.relayProgress(),
    };
  }

  /** 接龙进度(非机密,广播给所有人) */
  private relayProgress(): RelayProgress | null {
    if (this.phase !== 'relayDraw' && this.phase !== 'relayGuess') return null;
    const active = this.relayActiveId ? this.players.get(this.relayActiveId) : null;
    return {
      step: this.relayStep + 1,
      totalSteps: this.relayOrder.length,
      kind: this.phase === 'relayDraw' ? 'draw' : 'guess',
      activeId: this.relayActiveId ?? '',
      activeName: active?.name ?? '玩家',
    };
  }

  // ---------- 进出房 ----------

  addPlayer(id: string, name: string): void {
    if (this.players.has(id)) return this.rejoin(id);
    if (this.phase !== 'lobby') fail('游戏进行中,无法加入');
    if (this.players.size >= this.config.maxPlayers) fail('房间已满');
    this.players.set(id, {
      id,
      name,
      ready: false,
      online: true,
      score: 0,
      guessedAt: null,
      turnGain: 0,
      removeTimer: null,
      voiceJoined: false,
      voiceMuted: false,
    });
    if (this.players.size === 1) this.hostId = id;
    this.sendSystem(`${name} 加入了房间`);
    this.broadcastState();
    this.broadcastVoicePeers();
  }

  /** 断线重连:恢复 socket 绑定后回放全部状态 */
  rejoin(id: string): void {
    const p = this.players.get(id);
    if (!p) fail('不在该房间');
    if (p!.removeTimer != null) {
      this.clock.clearTimeout(p!.removeTimer);
      p!.removeTimer = null;
    }
    p!.online = true;
    // 语音连接已断,需要重新加入
    p!.voiceJoined = false;
    p!.voiceMuted = false;
    this.broadcastState();
    if (this.config.mode === 'relay') {
      this.resendRelayTo(id);
      this.broadcastVoicePeers();
      return;
    }
    this.io.send(id, 'draw:sync', { strokes: this.strokes });
    if (this.phase === 'choosing' && id === this.drawerId) {
      this.sendWordOptions();
    }
    if (this.phase === 'drawing' && this.word && (id === this.drawerId || p!.guessedAt != null)) {
      this.io.send(id, 'game:word', { word: this.word.text });
    }
    if (this.phase === 'gameEnd') {
      this.io.send(id, 'game:gallery', { turns: this.turnHistory });
    }
    this.broadcastVoicePeers();
  }

  /** 主动离开:立即移除 */
  leave(id: string): void {
    this.removePlayer(id, `${this.players.get(id)?.name ?? '玩家'} 离开了房间`);
  }

  /** 断线:lobby 直接移除;对局中保留宽限期 */
  onDisconnect(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.removePlayer(id, `${p.name} 离开了房间`);
      return;
    }
    p.online = false;
    p.voiceJoined = false;
    this.sendSystem(`${p.name} 掉线了,等待重连…`);
    p.removeTimer = this.clock.setTimeout(() => {
      p.removeTimer = null;
      this.removePlayer(id, `${p.name} 已离开游戏`);
    }, RECONNECT_GRACE_MS);
    this.broadcastState();
    this.broadcastVoicePeers();
    if (this.config.mode === 'relay') {
      // 接龙:当前活动玩家掉线立即以现有内容结算该环并推进,不拖累全场
      if (this.phase === 'relayDraw' && id === this.relayActiveId) this.finishRelayDraw(true);
      else if (this.phase === 'relayGuess' && id === this.relayActiveId) this.finishRelayGuess('', true);
      return;
    }
    // 画者掉线立即结束回合;猜词者掉线可能触发"全员已猜中"
    if ((this.phase === 'choosing' || this.phase === 'drawing') && id === this.drawerId) {
      this.endTurn('drawerLeft');
    } else if (this.phase === 'drawing') {
      this.checkAllGuessed();
    }
  }

  private removePlayer(id: string, systemMsg: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.removeTimer != null) this.clock.clearTimeout(p.removeTimer);
    this.players.delete(id);
    this.drawQueue = this.drawQueue.filter((d) => d !== id);
    this.hooks.onPlayerRemoved(id);
    if (this.players.size === 0) {
      this.destroy();
      return;
    }
    if (id === this.hostId) {
      this.hostId = this.players.keys().next().value as string;
      const host = this.players.get(this.hostId)!;
      host.ready = false;
      this.sendSystem(`${host.name} 成为新房主`);
    }
    this.sendSystem(systemMsg);
    this.broadcastVoicePeers();
    const inGame = this.phase !== 'lobby' && this.phase !== 'gameEnd';
    if (inGame && this.players.size < MIN_PLAYERS) {
      this.sendSystem('人数不足,游戏结束');
      this.resetToLobby();
      return;
    }
    if (this.config.mode === 'relay') {
      if ((this.phase === 'relayDraw' || this.phase === 'relayGuess') && id === this.relayActiveId) {
        if (this.phase === 'relayDraw') this.finishRelayDraw(true);
        else this.finishRelayGuess('', true);
        return;
      }
      this.broadcastState();
      return;
    }
    if ((this.phase === 'choosing' || this.phase === 'drawing') && id === this.drawerId) {
      this.endTurn('drawerLeft');
      return;
    }
    if (this.phase === 'drawing') {
      this.broadcastState();
      this.checkAllGuessed();
      return;
    }
    this.broadcastState();
    this.broadcastVoicePeers();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimers();
    for (const p of this.players.values()) {
      if (p.removeTimer != null) this.clock.clearTimeout(p.removeTimer);
    }
    this.players.clear();
    this.hooks.onEmpty();
  }

  // ---------- 准备/开始 ----------

  setReady(id: string, ready: boolean): void {
    const p = this.players.get(id) ?? fail('不在房间中') as never;
    if (this.phase !== 'lobby') fail('当前不可更改准备状态');
    if (id === this.hostId) fail('房主无需准备');
    p.ready = ready;
    this.broadcastState();
  }

  startGame(id: string): void {
    if (this.phase !== 'lobby') fail('游戏已开始');
    if (id !== this.hostId) fail('只有房主可以开始游戏');
    const minPlayers = this.config.mode === 'relay' ? RELAY_MIN_PLAYERS : MIN_PLAYERS;
    if (this.players.size < minPlayers) fail(`至少需要 ${minPlayers} 名玩家`);
    for (const p of this.players.values()) {
      if (p.id !== this.hostId && !p.ready) fail('还有玩家未准备');
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.ready = false;
    }
    this.usedWords.clear();
    this.ranking = null;
    this.turnHistory = [];
    if (this.config.mode === 'relay') {
      this.startRelay();
      return;
    }
    this.round = 1;
    this.buildQueue();
    this.sendSystem('游戏开始!');
    this.nextTurn();
  }

  /** 结算页回到房间(仅房主) */
  playAgain(id: string): void {
    if (this.phase !== 'gameEnd') fail('当前不在结算阶段');
    if (id !== this.hostId) fail('只有房主可以发起再来一局');
    this.sendSystem('房主发起了再来一局');
    this.resetToLobby();
  }

  // ---------- 回合推进 ----------

  private buildQueue(): void {
    this.drawQueue = [...this.players.keys()];
    this.turnsPerRound = this.drawQueue.length;
  }

  private canDraw(id: string): boolean {
    return this.players.get(id)?.online === true;
  }

  private nextTurn(): void {
    this.clearTimers();
    while (this.drawQueue.length > 0 && !this.canDraw(this.drawQueue[0])) this.drawQueue.shift();
    if (this.drawQueue.length === 0) {
      if (this.round >= this.config.rounds) return this.endGame();
      this.round += 1;
      this.buildQueue();
      while (this.drawQueue.length > 0 && !this.canDraw(this.drawQueue[0])) this.drawQueue.shift();
      if (this.drawQueue.length === 0) return this.endGame();
    }
    const drawerId = this.drawQueue.shift()!;
    this.turnInRound = this.turnsPerRound - this.drawQueue.length;
    this.beginTurn(drawerId);
  }

  private beginTurn(drawerId: string): void {
    this.drawerId = drawerId;
    this.word = null;
    this.revealedIndex = null;
    this.categoryRevealed = false;
    this.turnResult = null;
    this.strokes = [];
    this.strokeById.clear();
    for (const p of this.players.values()) {
      p.guessedAt = null;
      p.turnGain = 0;
    }
    this.phase = 'choosing';
    this.wordRefreshLeft = WORD_REFRESH_PER_TURN;
    this.offeredWords.clear();
    this.wordOptions = this.pickOptions();
    this.timerEndsAt = this.clock.now() + CHOOSE_SECONDS * 1000;
    this.phaseTimer = this.clock.setTimeout(() => this.doChooseWord(0), CHOOSE_SECONDS * 1000);
    this.broadcastState();
    this.broadcast('draw:sync', { strokes: [] });
    this.sendWordOptions();
  }

  private pickOptions(): WordOption[] {
    const exclude = new Set([...this.usedWords, ...this.offeredWords]);
    const options = pickWords(this.config.wordOptionCount, exclude, this.rng);
    for (const w of options) this.offeredWords.add(w.text);
    return options;
  }

  private sendWordOptions(): void {
    if (this.drawerId) {
      this.io.send(this.drawerId, 'game:wordOptions', {
        words: this.wordOptions,
        refreshLeft: this.wordRefreshLeft,
      });
    }
  }

  chooseWord(id: string, index: number, text?: string): void {
    if (this.phase !== 'choosing') fail('当前不在选词阶段');
    if (id !== this.drawerId) fail('只有画者可以选词');
    if (!Number.isInteger(index) || index < 0 || index >= this.wordOptions.length) fail('无效的选择');
    // 客户端点击"换一批"后瞬间又点旧词:此时服务端列表已换新,靠词文本对账拒绝误选
    if (text !== undefined && this.wordOptions[index].text !== text) {
      fail('候选词已更新,请重新选择');
    }
    this.doChooseWord(index);
  }

  /** 画者刷新候选词列表(每回合限 WORD_REFRESH_PER_TURN 次,不重置选词倒计时) */
  refreshWords(id: string): void {
    if (this.phase !== 'choosing') fail('当前不在选词阶段');
    if (id !== this.drawerId) fail('只有画者可以刷新候选词');
    if (this.wordRefreshLeft <= 0) fail('刷新次数已用完');
    this.wordRefreshLeft -= 1;
    this.wordOptions = this.pickOptions();
    this.sendWordOptions();
  }

  private doChooseWord(index: number): void {
    this.clearTimers();
    this.word = this.wordOptions[index];
    this.usedWords.add(this.word.text);
    this.phase = 'drawing';
    const ms = this.config.drawSeconds * 1000;
    this.timerEndsAt = this.clock.now() + ms;
    this.phaseTimer = this.clock.setTimeout(() => this.endTurn('timeout'), ms);
    // 剩余时间低于阈值时揭示一个字
    if ([...this.word.text].length > 1) {
      this.revealTimer = this.clock.setTimeout(() => {
        const chars = [...this.word!.text];
        this.revealedIndex = Math.floor(this.rng() * chars.length);
        this.revealTimer = null;
        this.broadcastState();
      }, ms * (1 - REVEAL_CHAR_RATIO));
    }
    // 类型提示延迟显示
    const categoryDelay = this.config.categoryHintSeconds * 1000;
    if (categoryDelay <= 0) {
      this.categoryRevealed = true;
    } else if (categoryDelay < ms) {
      this.categoryTimer = this.clock.setTimeout(() => {
        this.categoryRevealed = true;
        this.categoryTimer = null;
        this.broadcastState();
      }, categoryDelay);
    }
    this.broadcastState();
    this.io.send(this.drawerId!, 'game:word', { word: this.word.text });
  }

  private endTurn(reason: TurnResult['reason']): void {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.clearTimers();
    const gains: Record<string, number> = {};
    for (const p of this.players.values()) {
      if (p.turnGain > 0) gains[p.id] = p.turnGain;
    }
    this.turnResult = { word: this.word?.text ?? '', gains, reason };
    this.recordTurn();
    // turnEnd 阶段保留 drawerId 供 UI 展示"刚才是谁画的"
    this.phase = 'turnEnd';
    this.timerEndsAt = this.clock.now() + TURN_END_SECONDS * 1000;
    this.phaseTimer = this.clock.setTimeout(() => this.nextTurn(), TURN_END_SECONDS * 1000);
    this.broadcastState();
  }

  /** 把当前回合快照进历史(供结算画廊);未选词的回合不记录 */
  private recordTurn(): void {
    if (!this.word) return;
    const drawerId = this.drawerId ?? '';
    const drawerName = this.players.get(drawerId)?.name ?? '玩家';
    const correctGuessers = [...this.players.values()]
      .filter((p) => p.id !== drawerId && p.guessedAt != null)
      .sort((a, b) => (a.guessedAt ?? 0) - (b.guessedAt ?? 0))
      .map((p) => ({ playerId: p.id, name: p.name, gain: p.turnGain }));
    this.turnHistory.push({
      round: this.round,
      turnInRound: this.turnInRound,
      drawerId,
      drawerName,
      word: this.word.text,
      strokes: this.strokes.map((s) => ({ ...s, points: [...s.points] })),
      correctGuessers,
    });
  }

  private endGame(): void {
    this.clearTimers();
    this.phase = 'gameEnd';
    this.drawerId = null;
    this.word = null;
    this.timerEndsAt = null;
    this.ranking = this.computeRanking();
    this.sendSystem('游戏结束!');
    this.broadcastState();
    this.broadcast('game:gallery', { turns: this.turnHistory });
  }

  private computeRanking(): RankingEntry[] {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score);
    let lastScore = Number.NaN;
    let lastRank = 0;
    return sorted.map((p, i) => {
      const rank = p.score === lastScore ? lastRank : i + 1;
      lastScore = p.score;
      lastRank = rank;
      return { playerId: p.id, name: p.name, score: p.score, rank };
    });
  }

  // ---------- 接龙(relay)推进 ----------

  private startRelay(): void {
    this.relayOrder = [...this.players.keys()];
    this.relaySeed = pickWords(1, new Set(), this.rng)[0]?.text ?? '苹果';
    this.relayLinks = [];
    this.relayRecap = null;
    this.relayStep = 0;
    this.relayActiveId = null;
    this.sendSystem('接龙开始!第一位玩家拿到原始词开画,之后交替「看画猜词 / 看词作画」');
    this.beginRelayStep();
  }

  /** 每一步:偶数步作画、奇数步猜词;当前玩家不在线则记空环并跳过 */
  private beginRelayStep(): void {
    this.clearTimers();
    if (this.relayStep >= this.relayOrder.length) {
      this.endRelay();
      return;
    }
    const activeId = this.relayOrder[this.relayStep];
    const player = this.players.get(activeId);
    const kind: 'draw' | 'guess' = this.relayStep % 2 === 0 ? 'draw' : 'guess';
    if (!player || !player.online) {
      this.recordEmptyRelayLink(activeId, kind);
      this.relayStep += 1;
      this.beginRelayStep();
      return;
    }
    this.relayActiveId = activeId;
    this.strokes = [];
    this.strokeById.clear();
    if (kind === 'draw') {
      this.phase = 'relayDraw';
      const ms = this.config.drawSeconds * 1000;
      this.timerEndsAt = this.clock.now() + ms;
      this.phaseTimer = this.clock.setTimeout(() => this.finishRelayDraw(true), ms);
      this.broadcastState();
      this.io.send(activeId, 'draw:sync', { strokes: [] });
      this.io.send(activeId, 'relay:task', { kind: 'draw', prompt: this.currentRelayPrompt() });
    } else {
      this.phase = 'relayGuess';
      const ms = RELAY_GUESS_SECONDS * 1000;
      this.timerEndsAt = this.clock.now() + ms;
      this.phaseTimer = this.clock.setTimeout(() => this.finishRelayGuess('', true), ms);
      this.broadcastState();
      this.io.send(activeId, 'relay:task', { kind: 'guess', strokes: this.lastRelayDrawing() });
    }
  }

  /** 当前作画步要画的词:第一步是原始词,其后是上一环的猜词 */
  private currentRelayPrompt(): string {
    if (this.relayStep === 0) return this.relaySeed;
    const last = this.relayLinks[this.relayLinks.length - 1];
    return last && last.kind === 'guess' ? last.word : this.relaySeed;
  }

  /** 最近一环的画(供猜词者观看) */
  private lastRelayDrawing(): Stroke[] {
    for (let i = this.relayLinks.length - 1; i >= 0; i--) {
      const l = this.relayLinks[i];
      if (l.kind === 'draw') return l.strokes;
    }
    return [];
  }

  private recordEmptyRelayLink(activeId: string, kind: 'draw' | 'guess'): void {
    const name = this.players.get(activeId)?.name ?? '玩家';
    if (kind === 'draw') {
      this.relayLinks.push({ kind: 'draw', playerId: activeId, name, strokes: [] });
    } else {
      this.relayLinks.push({ kind: 'guess', playerId: activeId, name, word: '(缺席)' });
    }
  }

  private finishRelayDraw(auto: boolean): void {
    if (this.phase !== 'relayDraw') return;
    void auto;
    this.clearTimers();
    const activeId = this.relayActiveId ?? '';
    const name = this.players.get(activeId)?.name ?? '玩家';
    this.relayLinks.push({
      kind: 'draw',
      playerId: activeId,
      name,
      strokes: this.strokes.map((s) => ({ ...s, points: [...s.points] })),
    });
    this.relayStep += 1;
    this.beginRelayStep();
  }

  private finishRelayGuess(word: string, auto: boolean): void {
    if (this.phase !== 'relayGuess') return;
    this.clearTimers();
    const activeId = this.relayActiveId ?? '';
    const name = this.players.get(activeId)?.name ?? '玩家';
    const clean = String(word ?? '').trim().slice(0, CHAT_MAX_LEN);
    this.relayLinks.push({
      kind: 'guess',
      playerId: activeId,
      name,
      word: clean || (auto ? '(未猜)' : '(未猜)'),
    });
    this.relayStep += 1;
    this.beginRelayStep();
  }

  relayDone(id: string): void {
    if (this.phase !== 'relayDraw') fail('当前不在作画环节');
    if (id !== this.relayActiveId) fail('还没轮到你');
    this.finishRelayDraw(false);
  }

  relayGuess(id: string, word: string): void {
    if (this.phase !== 'relayGuess') fail('当前不在猜词环节');
    if (id !== this.relayActiveId) fail('还没轮到你');
    const w = String(word ?? '').trim();
    if (!w) fail('请输入你猜的词');
    this.finishRelayGuess(w, false);
  }

  private endRelay(): void {
    this.clearTimers();
    this.phase = 'gameEnd';
    this.relayActiveId = null;
    this.timerEndsAt = null;
    this.strokes = [];
    this.strokeById.clear();
    const guesses = this.relayLinks.filter(
      (l): l is Extract<RelayLink, { kind: 'guess' }> => l.kind === 'guess',
    );
    const finalGuess = guesses.length ? guesses[guesses.length - 1].word : null;
    const success = finalGuess != null && judgeGuess(finalGuess, this.relaySeed) === 'correct';
    this.relayRecap = { seed: this.relaySeed, links: this.relayLinks, finalGuess, success };
    const gain = success ? RELAY_SUCCESS_SCORE : 0;
    for (const p of this.players.values()) p.score = gain;
    this.ranking = this.computeRanking();
    this.sendSystem(
      success ? '🎉 接龙成功!首尾词一致,全队得分!' : '接龙结束,来看看这一路跑偏了多少 😆',
    );
    this.broadcastState();
    this.broadcast('relay:recap', { recap: this.relayRecap });
  }

  private resendRelayTo(id: string): void {
    if (this.phase === 'gameEnd') {
      if (this.relayRecap) this.io.send(id, 'relay:recap', { recap: this.relayRecap });
      return;
    }
    if (id !== this.relayActiveId) {
      // 等待者:清掉本地可能残留的画,避免看到机密内容
      this.io.send(id, 'draw:sync', { strokes: [] });
      return;
    }
    if (this.phase === 'relayDraw') {
      this.io.send(id, 'draw:sync', { strokes: this.strokes });
      this.io.send(id, 'relay:task', { kind: 'draw', prompt: this.currentRelayPrompt() });
    } else if (this.phase === 'relayGuess') {
      this.io.send(id, 'relay:task', { kind: 'guess', strokes: this.lastRelayDrawing() });
    }
  }

  private resetToLobby(): void {
    this.clearTimers();
    this.phase = 'lobby';
    this.round = 0;
    this.turnInRound = 0;
    this.turnsPerRound = 0;
    this.drawerId = null;
    this.word = null;
    this.wordOptions = [];
    this.offeredWords.clear();
    this.wordRefreshLeft = 0;
    this.revealedIndex = null;
    this.categoryRevealed = false;
    this.turnResult = null;
    this.ranking = null;
    this.timerEndsAt = null;
    this.strokes = [];
    this.strokeById.clear();
    this.relayOrder = [];
    this.relayLinks = [];
    this.relayStep = 0;
    this.relayActiveId = null;
    this.relayRecap = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.guessedAt = null;
      p.turnGain = 0;
      // 对局中掉线的玩家在 lobby 无宽限,直接移除
      if (!p.online) {
        if (p.removeTimer != null) this.clock.clearTimeout(p.removeTimer);
        this.players.delete(p.id);
        this.hooks.onPlayerRemoved(p.id);
      }
    }
    if (this.players.size === 0) {
      this.destroy();
      return;
    }
    if (!this.players.has(this.hostId)) {
      this.hostId = this.players.keys().next().value as string;
    }
    this.broadcast('draw:sync', { strokes: [] });
    this.broadcastState();
  }

  // ---------- 画板 ----------

  /** 当前是否有人可作画:经典画者 / 接龙作画者。返回是否需广播给他人(接龙为私密不广播) */
  private drawAuthority(id: string): 'classic' | 'relay' | null {
    if (this.phase === 'drawing' && id === this.drawerId) return 'classic';
    if (this.phase === 'relayDraw' && id === this.relayActiveId) return 'relay';
    return null;
  }

  addStroke(id: string, stroke: Stroke): void {
    const auth = this.drawAuthority(id);
    if (!auth) return;
    if (!stroke || typeof stroke.id !== 'string' || !Array.isArray(stroke.points)) return;
    const s: Stroke = {
      id: stroke.id,
      tool: stroke.tool === 'eraser' ? 'eraser' : 'pen',
      color: String(stroke.color).slice(0, 16),
      width: Math.min(80, Math.max(1, Number(stroke.width) || 4)),
      points: stroke.points.slice(0, 4000).map(clamp01),
    };
    this.strokes.push(s);
    this.strokeById.set(s.id, s);
    // 接龙作画对他人保密,不广播
    if (auth === 'classic') this.broadcastExcept(id, 'draw:stroke', s);
  }

  addPoints(id: string, strokeId: string, points: number[]): void {
    const auth = this.drawAuthority(id);
    if (!auth) return;
    const s = this.strokeById.get(strokeId);
    if (!s || !Array.isArray(points)) return;
    if (s.points.length > 8000) return; // 单笔上限,防滥用
    s.points.push(...points.slice(0, 512).map(clamp01));
    if (auth === 'classic') this.broadcastExcept(id, 'draw:point', { strokeId, points });
  }

  clearCanvas(id: string): void {
    const auth = this.drawAuthority(id);
    if (!auth) return;
    this.strokes = [];
    this.strokeById.clear();
    if (auth === 'classic') this.broadcastExcept(id, 'draw:clear');
  }

  // ---------- 聊天与猜词 ----------

  chat(id: string, rawText: string): void {
    const p = this.players.get(id) ?? fail('不在房间中') as never;
    const text = String(rawText ?? '').trim().slice(0, CHAT_MAX_LEN);
    if (!text) fail('消息不能为空');

    if (this.phase !== 'drawing' || !this.word) {
      this.broadcastChat({ kind: 'chat', playerId: id, name: p.name, text });
      return;
    }

    const judge = judgeGuess(text, this.word.text);

    if (id === this.drawerId) {
      if (judge !== 'wrong') fail('不能透露答案哦');
      this.broadcastChat({ kind: 'chat', playerId: id, name: p.name, text });
      return;
    }

    if (p.guessedAt != null) {
      // 已猜中者发言仅画者与其他已猜中者可见
      const targets = [...this.players.values()]
        .filter((t) => t.id === this.drawerId || t.guessedAt != null)
        .map((t) => t.id);
      this.sendChatTo(targets, { kind: 'chat', playerId: id, name: `${p.name}(已猜中)`, text });
      return;
    }

    if (judge === 'correct') {
      this.onCorrectGuess(p);
      return;
    }
    this.broadcastChat({ kind: 'chat', playerId: id, name: p.name, text });
    if (judge === 'close') {
      this.sendChatTo([id], { kind: 'close', text: '很接近了!' });
    }
  }

  private onCorrectGuess(p: PlayerInternal): void {
    const now = this.clock.now();
    const total = this.config.drawSeconds * 1000;
    const left = Math.max(0, (this.timerEndsAt ?? now) - now);
    const isFirst = ![...this.players.values()].some((t) => t.guessedAt != null);
    const gain = Math.max(10, Math.round((100 * left) / total)) + (isFirst ? FIRST_GUESS_BONUS : 0);
    p.guessedAt = now;
    p.score += gain;
    p.turnGain += gain;
    const drawer = this.drawerId ? this.players.get(this.drawerId) : null;
    if (drawer) {
      drawer.score += DRAWER_POINT_PER_GUESS;
      drawer.turnGain += DRAWER_POINT_PER_GUESS;
    }
    this.io.send(p.id, 'game:word', { word: this.word!.text });
    this.sendChatTo([p.id], { kind: 'correct', text: `你猜对了!+${gain}` });
    this.broadcastChat({ kind: 'system', text: `${p.name} 猜对了!` });
    this.broadcastState();
    this.checkAllGuessed();
  }

  private checkAllGuessed(): void {
    if (this.phase !== 'drawing') return;
    const onlineGuessers = [...this.players.values()].filter(
      (p) => p.id !== this.drawerId && p.online,
    );
    if (onlineGuessers.length === 0) return;
    if (onlineGuessers.every((p) => p.guessedAt != null)) this.endTurn('allGuessed');
  }

  // ---------- 语音 ----------

  voiceJoin(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.voiceJoined = true;
    p.voiceMuted = false;
    this.broadcastVoicePeers();
  }

  voiceLeave(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.voiceJoined = false;
    this.broadcastVoicePeers();
  }

  voiceMute(id: string, muted: boolean): void {
    const p = this.players.get(id);
    if (!p || !p.voiceJoined) return;
    p.voiceMuted = muted;
    this.broadcastVoicePeers();
  }

  getVoicePeers(): { playerId: string; muted: boolean }[] {
    return [...this.players.values()]
      .filter((p) => p.voiceJoined && p.online)
      .map((p) => ({ playerId: p.id, muted: p.voiceMuted }));
  }

  private broadcastVoicePeers(): void {
    this.broadcast('voice:peers', { peers: this.getVoicePeers() });
  }

  // ---------- 发送工具 ----------

  private clearTimers(): void {
    if (this.phaseTimer != null) this.clock.clearTimeout(this.phaseTimer);
    if (this.revealTimer != null) this.clock.clearTimeout(this.revealTimer);
    if (this.categoryTimer != null) this.clock.clearTimeout(this.categoryTimer);
    this.phaseTimer = null;
    this.revealTimer = null;
    this.categoryTimer = null;
  }

  private broadcast<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const p of this.players.values()) {
      if (p.online) this.io.send(p.id, event, ...args);
    }
  }

  private broadcastExcept<E extends keyof ServerToClientEvents>(
    exceptId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const p of this.players.values()) {
      if (p.online && p.id !== exceptId) this.io.send(p.id, event, ...args);
    }
  }

  broadcastState(): void {
    const state = this.toState();
    this.broadcast('room:state', state);
  }

  private buildMsg(partial: Omit<ChatMsg, 'id' | 'ts'>): ChatMsg {
    return { ...partial, id: `${this.id}-${++this.msgSeq}`, ts: this.clock.now() };
  }

  private broadcastChat(partial: Omit<ChatMsg, 'id' | 'ts'>): void {
    this.broadcast('chat:msg', this.buildMsg(partial));
  }

  private sendChatTo(targets: string[], partial: Omit<ChatMsg, 'id' | 'ts'>): void {
    const msg = this.buildMsg(partial);
    for (const t of targets) {
      const p = this.players.get(t);
      if (p?.online) this.io.send(t, 'chat:msg', msg);
    }
  }

  private sendSystem(text: string): void {
    this.broadcastChat({ kind: 'system', text });
  }
}

function clamp01(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
