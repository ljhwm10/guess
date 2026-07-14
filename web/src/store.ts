import { create } from 'zustand';
import type {
  ChatMsg,
  RelayRecap,
  RoomState,
  RoomSummary,
  Stroke,
  TurnRecord,
  VoicePeer,
  WordOption,
} from '@draw-guess/shared';

export type View = 'home' | 'room';
export type Theme = 'light' | 'dark';
/** 接龙:发给当前活动玩家的私密任务 */
export type RelayTask =
  | { kind: 'draw'; prompt: string }
  | { kind: 'redraw'; strokes: Stroke[] }
  | { kind: 'guess'; strokes: Stroke[] };

interface GameStore {
  playerId: string;
  name: string;
  connected: boolean;
  view: View;
  roomState: RoomState | null;
  rooms: RoomSummary[];
  chats: ChatMsg[];
  wordOptions: WordOption[] | null;
  /** 本回合剩余的候选词刷新次数 */
  wordRefreshLeft: number;
  /** 画者/已猜中者可见的原词 */
  word: string | null;
  voicePeers: VoicePeer[];
  voiceJoined: boolean;
  voiceMuted: boolean;
  toast: string | null;
  /** 结算画廊:整局每回合存档,仅 gameEnd 阶段有值 */
  gallery: TurnRecord[] | null;
  /** 接龙:当前轮到我时的私密任务(画什么词 / 看哪幅画) */
  relayTask: RelayTask | null;
  /** 接龙:整链回放,仅 gameEnd 阶段有值 */
  relayRecap: RelayRecap | null;
  /** 日间/夜间主题(默认日间) */
  theme: Theme;
  /** 分享链接带来的待进入房间号(六位数字),消费后清空 */
  pendingRoomId: string | null;

  setName(name: string): void;
  setConnected(connected: boolean): void;
  setView(view: View): void;
  setRoomState(s: RoomState | null): void;
  setRooms(rooms: RoomSummary[]): void;
  pushChat(m: ChatMsg): void;
  clearChats(): void;
  setWordOptions(w: WordOption[] | null, refreshLeft?: number): void;
  setWord(w: string | null): void;
  setVoicePeers(peers: VoicePeer[]): void;
  setVoiceJoined(joined: boolean): void;
  setVoiceMuted(muted: boolean): void;
  setGallery(g: TurnRecord[] | null): void;
  setRelayTask(t: RelayTask | null): void;
  setRelayRecap(r: RelayRecap | null): void;
  showToast(text: string): void;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setPendingRoomId(id: string | null): void;
}

function loadPlayerId(): string {
  const key = 'dg:playerId';
  let id = localStorage.getItem(key);
  if (!id || id.length < 8) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function loadTheme(): Theme {
  return localStorage.getItem('dg:theme') === 'dark' ? 'dark' : 'light';
}

/** 将主题落到 <html data-theme> 与 theme-color,供 CSS 变量切换 */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#171528' : '#f5f6fc');
}

/** 从当前 URL 解析分享进房参数(仅接受六位数字房号) */
function loadPendingRoomId(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('room');
    if (raw && /^\d{6}$/.test(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

const initialTheme = loadTheme();
applyTheme(initialTheme);

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<GameStore>((set, get) => ({
  playerId: loadPlayerId(),
  name: localStorage.getItem('dg:name') ?? '',
  connected: false,
  view: 'home',
  roomState: null,
  rooms: [],
  chats: [],
  wordOptions: null,
  wordRefreshLeft: 0,
  word: null,
  voicePeers: [],
  voiceJoined: false,
  voiceMuted: false,
  toast: null,
  gallery: null,
  relayTask: null,
  relayRecap: null,
  theme: initialTheme,
  pendingRoomId: loadPendingRoomId(),

  setName: (name) => {
    localStorage.setItem('dg:name', name);
    set({ name });
  },
  setConnected: (connected) => set({ connected }),
  setView: (view) => set({ view }),
  setRoomState: (roomState) => set({ roomState }),
  setRooms: (rooms) => set({ rooms }),
  pushChat: (m) => set((s) => ({ chats: [...s.chats.slice(-199), m] })),
  clearChats: () => set({ chats: [] }),
  setWordOptions: (wordOptions, refreshLeft) => set({ wordOptions, wordRefreshLeft: refreshLeft ?? 0 }),
  setWord: (word) => set({ word }),
  setVoicePeers: (voicePeers) => set({ voicePeers }),
  setVoiceJoined: (voiceJoined) => set({ voiceJoined }),
  setVoiceMuted: (voiceMuted) => set({ voiceMuted }),
  setGallery: (gallery) => set({ gallery }),
  setRelayTask: (relayTask) => set({ relayTask }),
  setRelayRecap: (relayRecap) => set({ relayRecap }),
  showToast: (text) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  setTheme: (theme) => {
    localStorage.setItem('dg:theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  setPendingRoomId: (pendingRoomId) => set({ pendingRoomId }),
}));

/** 便捷选择器 */
export const useMe = (): { id: string; isHost: boolean; isDrawer: boolean } => {
  const playerId = useStore((s) => s.playerId);
  const roomState = useStore((s) => s.roomState);
  return {
    id: playerId,
    isHost: roomState?.hostId === playerId,
    isDrawer: roomState?.drawerId === playerId,
  };
};
