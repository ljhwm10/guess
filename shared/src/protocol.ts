export type Tool = 'pen' | 'eraser';

/** points 为归一化坐标平铺数组 [x0,y0,x1,y1,...],范围 0..1(相对 800×600 逻辑面) */
export interface Stroke {
  id: string;
  tool: Tool;
  color: string;
  /** 逻辑像素线宽(相对 800×600 逻辑面) */
  width: number;
  points: number[];
}

/** classic:经典你画我猜;relay:接龙(单链依次画→猜) */
export type GameMode = 'classic' | 'relay';

export interface RoomConfig {
  /** 游戏模式 */
  mode: GameMode;
  maxPlayers: number;
  rounds: number;
  /** 作画/猜词时长(秒) */
  drawSeconds: number;
  /** 作画开始后多少秒显示类型提示(0 = 立即显示) */
  categoryHintSeconds: number;
  /** 每回合候选词数量 */
  wordOptionCount: number;
}

export type RoomPhase =
  | 'lobby'
  | 'choosing'
  | 'drawing'
  | 'turnEnd'
  | 'gameEnd'
  // 接龙模式:当前活动玩家在作画 / 在写猜词;其余玩家等待
  | 'relayDraw'
  | 'relayGuess';

/** 接龙进度(广播给所有人的非机密信息) */
export interface RelayProgress {
  /** 第几步(1 起) */
  step: number;
  /** 总步数(= 开局人数) */
  totalSteps: number;
  /** 当前活动玩家在画还是在猜 */
  kind: 'draw' | 'guess';
  activeId: string;
  activeName: string;
}

/** 接龙一环:一幅画,或一个猜词 */
export type RelayLink =
  | { kind: 'draw'; playerId: string; name: string; strokes: Stroke[] }
  | { kind: 'guess'; playerId: string; name: string; word: string };

/** 接龙整链回放(结算时下发) */
export interface RelayRecap {
  /** 系统发的原始词 */
  seed: string;
  links: RelayLink[];
  /** 最后一个猜词(若最后一环是猜词) */
  finalGuess: string | null;
  /** 首尾词是否一致 */
  success: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  online: boolean;
  score: number;
  /** 当前回合是否已猜中 */
  guessed: boolean;
}

export interface TurnResult {
  word: string;
  /** playerId -> 本回合得分 */
  gains: Record<string, number>;
  reason: 'allGuessed' | 'timeout' | 'drawerLeft';
}

export interface RankingEntry {
  playerId: string;
  name: string;
  score: number;
  rank: number;
}

/** 一回合的完整存档,供结算后画廊/回顾展示 */
export interface TurnRecord {
  round: number;
  turnInRound: number;
  drawerId: string;
  drawerName: string;
  word: string;
  /** 该回合最终画布的笔画快照 */
  strokes: Stroke[];
  /** 本回合猜中者(按猜中先后),含各自得分 */
  correctGuessers: { playerId: string; name: string; gain: number }[];
}

export interface RoomState {
  id: string;
  phase: RoomPhase;
  config: RoomConfig;
  players: PlayerView[];
  hostId: string;
  /** 当前轮次(1 起),lobby 时为 0 */
  round: number;
  totalRounds: number;
  /** 本轮第几个画者(1 起) */
  turnInRound: number;
  turnsPerRound: number;
  drawerId: string | null;
  /** 猜词端可见的掩码提示,如「＿马＿」;画者/lobby 为 null */
  wordHint: string | null;
  /** 词的分类提示,如「动物」;作画开始 categoryHintSeconds 秒后才下发,之前为 null */
  wordCategory: string | null;
  /** 当前阶段截止时间(epoch ms),无计时为 null */
  timerEndsAt: number | null;
  turnResult: TurnResult | null;
  ranking: RankingEntry[] | null;
  /** 接龙进度,仅 relay 模式对局中非空 */
  relay: RelayProgress | null;
}

export interface RoomSummary {
  id: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  phase: RoomPhase;
}

export type ChatKind = 'chat' | 'system' | 'correct' | 'close';

export interface ChatMsg {
  id: string;
  kind: ChatKind;
  playerId?: string;
  name?: string;
  text: string;
  ts: number;
}

export interface WordOption {
  text: string;
  hint: string;
}

export interface VoicePeer {
  playerId: string;
  muted: boolean;
}

export type AckRes<T> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T = Record<never, never>> = (res: AckRes<T>) => void;

export interface ClientToServerEvents {
  hello: (p: { playerId: string; name: string }, ack: Ack<{ inRoom: boolean }>) => void;
  'room:create': (p: { config: Partial<RoomConfig> }, ack: Ack<{ roomId: string }>) => void;
  'room:join': (p: { roomId: string }, ack: Ack) => void;
  'room:leave': (ack: Ack) => void;
  'room:list': (ack: Ack<{ rooms: RoomSummary[] }>) => void;
  'room:ready': (p: { ready: boolean }, ack: Ack) => void;
  'game:start': (ack: Ack) => void;
  /** text 用于校验所选词与服务端当前列表一致(防"换一批"竞态误选) */
  'game:chooseWord': (p: { index: number; text?: string }, ack: Ack) => void;
  /** 画者刷新候选词列表(每回合限次),成功后服务端重发 game:wordOptions */
  'game:refreshWords': (ack: Ack) => void;
  'game:again': (ack: Ack) => void;
  /** 接龙:当前作画者完成作画,进入下一环 */
  'relay:done': (ack: Ack) => void;
  /** 接龙:当前猜词者提交猜词 */
  'relay:guess': (p: { word: string }, ack: Ack) => void;
  'draw:stroke': (s: Stroke) => void;
  'draw:point': (p: { strokeId: string; points: number[] }) => void;
  'draw:clear': () => void;
  'chat:send': (p: { text: string }, ack: Ack) => void;
  'voice:join': () => void;
  'voice:leave': () => void;
  'voice:mute': (p: { muted: boolean }) => void;
  'voice:signal': (p: { to: string; data: unknown }) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  /** 仅画者:候选词与剩余刷新次数 */
  'game:wordOptions': (p: { words: WordOption[]; refreshLeft: number }) => void;
  /** 仅画者与已猜中者:答案原词 */
  'game:word': (p: { word: string }) => void;
  'draw:stroke': (s: Stroke) => void;
  'draw:point': (p: { strokeId: string; points: number[] }) => void;
  'draw:clear': () => void;
  /** 全量笔画(入房/重连恢复) */
  'draw:sync': (p: { strokes: Stroke[] }) => void;
  'chat:msg': (m: ChatMsg) => void;
  /** 结算画廊:整局每回合的存档,仅 gameEnd 时下发一次(重连补发) */
  'game:gallery': (p: { turns: TurnRecord[] }) => void;
  /**
   * 接龙:发给当前活动玩家的私密任务。
   *  - draw:   首位,照原始词 prompt 作画
   *  - redraw: 中间位,看上一位的画 strokes,凭记忆重画一幅
   *  - guess:  末位,看上一位的画 strokes,猜出词
   */
  'relay:task': (
    p:
      | { kind: 'draw'; prompt: string }
      | { kind: 'redraw'; strokes: Stroke[] }
      | { kind: 'guess'; strokes: Stroke[] },
  ) => void;
  /** 接龙:整链回放,仅 gameEnd 时下发一次(重连补发) */
  'relay:recap': (p: { recap: RelayRecap }) => void;
  'voice:peers': (p: { peers: VoicePeer[] }) => void;
  'voice:signal': (p: { from: string; data: unknown }) => void;
}
