import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  RoomConfig,
  ServerToClientEvents,
  Stroke,
} from '@draw-guess/shared';
import { useStore } from './store';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

// ---------- 笔画缓存与画板事件总线(不进 React state,保证性能) ----------

export type DrawEvent =
  | { type: 'sync' }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'point'; strokeId: string; points: number[] }
  | { type: 'clear' };

export const strokeCache: Stroke[] = [];
const strokeById = new Map<string, Stroke>();
const drawSubs = new Set<(e: DrawEvent) => void>();

export function getStrokeById(id: string): Stroke | undefined {
  return strokeById.get(id);
}

export function onDrawEvent(cb: (e: DrawEvent) => void): () => void {
  drawSubs.add(cb);
  return () => drawSubs.delete(cb);
}

function emitDrawEvent(e: DrawEvent): void {
  for (const cb of drawSubs) cb(e);
}

/** 画者本地落笔(直接进缓存,同时发给服务器) */
export function localStroke(stroke: Stroke): void {
  strokeCache.push(stroke);
  strokeById.set(stroke.id, stroke);
  socket.emit('draw:stroke', stroke);
}

export function localPoints(strokeId: string, points: number[]): void {
  strokeById.get(strokeId)?.points.push(...points);
  socket.emit('draw:point', { strokeId, points });
}

export function localClear(): void {
  strokeCache.length = 0;
  strokeById.clear();
  socket.emit('draw:clear');
  emitDrawEvent({ type: 'clear' });
}

function resetStrokes(strokes: Stroke[]): void {
  strokeCache.length = 0;
  strokeById.clear();
  for (const s of strokes) {
    strokeCache.push(s);
    strokeById.set(s.id, s);
  }
}

// ---------- 服务端事件 ----------

const store = (): ReturnType<typeof useStore.getState> => useStore.getState();

socket.on('connect', () => {
  store().setConnected(true);
  const { playerId, name } = store();
  if (!name) return;
  socket.emit('hello', { playerId, name }, (res) => {
    if (res.ok) {
      if (res.inRoom) {
        store().setView('room');
      } else if (store().view === 'room') {
        // 宽限期已过被移出房间
        store().setView('home');
        store().setRoomState(null);
        store().showToast('已离开原房间');
      }
    }
  });
});

socket.on('disconnect', () => {
  store().setConnected(false);
});

socket.on('room:state', (s) => {
  const prev = store().roomState;
  store().setRoomState(s);
  // 阶段切换时清理上一回合的词信息
  if (s.phase !== prev?.phase && (s.phase === 'choosing' || s.phase === 'lobby')) {
    store().setWord(null);
    store().setWordOptions(null);
  }
  if (s.phase === 'drawing') {
    store().setWordOptions(null);
  }
  // 画廊/回放只在结算阶段有效,进入其它阶段(如再来一局回大厅)即清空
  if (s.phase !== 'gameEnd') {
    if (store().gallery) store().setGallery(null);
    if (store().relayRecap) store().setRelayRecap(null);
  }
  // 接龙私密任务:不在接龙作画/猜词阶段,或已不是当前活动玩家,则清空
  const relayActive = s.phase === 'relayDraw' || s.phase === 'relayGuess';
  if (!relayActive || s.relay?.activeId !== store().playerId) {
    if (store().relayTask) store().setRelayTask(null);
  }
});

socket.on('game:gallery', ({ turns }) => store().setGallery(turns));
socket.on('relay:task', (task) => store().setRelayTask(task));
socket.on('relay:recap', ({ recap }) => store().setRelayRecap(recap));

socket.on('game:wordOptions', ({ words, refreshLeft }) => store().setWordOptions(words, refreshLeft));
socket.on('game:word', ({ word }) => store().setWord(word));
socket.on('chat:msg', (m) => store().pushChat(m));

socket.on('draw:sync', ({ strokes }) => {
  resetStrokes(strokes);
  emitDrawEvent({ type: 'sync' });
});

socket.on('draw:stroke', (s) => {
  strokeCache.push(s);
  strokeById.set(s.id, s);
  emitDrawEvent({ type: 'stroke', stroke: s });
});

socket.on('draw:point', ({ strokeId, points }) => {
  strokeById.get(strokeId)?.points.push(...points);
  emitDrawEvent({ type: 'point', strokeId, points });
});

socket.on('draw:clear', () => {
  strokeCache.length = 0;
  strokeById.clear();
  emitDrawEvent({ type: 'clear' });
});

// ---------- 客户端动作 ----------

function ackToast(res: { ok: true } | { ok: false; error: string }): boolean {
  if (!res.ok) store().showToast(res.error || '操作失败');
  return res.ok;
}

/** 首页点击进入:确保连接并 hello */
export function enterGame(name: string): void {
  store().setName(name);
  if (!socket.connected) {
    socket.connect();
  } else {
    socket.emit('hello', { playerId: store().playerId, name }, () => {});
  }
}

export function createRoom(config: Partial<RoomConfig>): void {
  socket.emit('room:create', { config }, (res) => {
    if (ackToast(res)) {
      store().clearChats();
      store().setView('room');
    }
  });
}

export function joinRoom(roomId: string): void {
  socket.emit('room:join', { roomId }, (res) => {
    if (ackToast(res)) {
      store().clearChats();
      store().setView('room');
    }
  });
}

export function leaveRoom(): void {
  socket.emit('room:leave', () => {});
  store().setView('home');
  store().setRoomState(null);
  store().setVoicePeers([]);
  store().clearChats();
  store().setGallery(null);
  store().setRelayTask(null);
  store().setRelayRecap(null);
}

export function relayDone(): void {
  socket.emit('relay:done', ackToast);
}

export function relaySubmitGuess(word: string, onOk: () => void): void {
  socket.emit('relay:guess', { word }, (res) => {
    if (ackToast(res)) onOk();
  });
}

export function refreshRooms(): void {
  if (!socket.connected) return;
  socket.emit('room:list', (res) => {
    if (res.ok) store().setRooms(res.rooms);
  });
}

export function setReady(ready: boolean): void {
  socket.emit('room:ready', { ready }, ackToast);
}

export function startGame(): void {
  socket.emit('game:start', ackToast);
}

export function chooseWord(index: number, text: string): void {
  socket.emit('game:chooseWord', { index, text }, ackToast);
}

export function refreshWords(onDone?: (ok: boolean) => void): void {
  socket.emit('game:refreshWords', (res) => {
    onDone?.(ackToast(res));
  });
}

export function playAgain(): void {
  socket.emit('game:again', ackToast);
}

export function sendChat(text: string, onOk: () => void): void {
  socket.emit('chat:send', { text }, (res) => {
    if (ackToast(res)) onOk();
  });
}
