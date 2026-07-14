import { useEffect } from 'react';
import { useStore } from './store';
import { HomePage } from './components/HomePage';
import { RoomView } from './components/RoomView';
import { GameView } from './components/GameView';
import { RelayView } from './components/RelayView';

export function App(): JSX.Element {
  const view = useStore((s) => s.view);
  const roomState = useStore((s) => s.roomState);
  const connected = useStore((s) => s.connected);
  const name = useStore((s) => s.name);
  const toast = useStore((s) => s.toast);

  // 有昵称但尚未连接(如刷新页面)时不自动连,由首页按钮触发;
  // 但若已处于 room 视图(重连场景)保持即可,这里只兜底提示。
  useEffect(() => {
    document.title = roomState ? `房间 ${roomState.id} · 你画我猜` : '你画我猜 · Draw & Guess';
  }, [roomState]);

  // 地址栏与房间状态保持同步:在房间内写入 ?room=,离开后移除,便于直接分享/刷新重进
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (view === 'room' && roomState) url.searchParams.set('room', roomState.id);
      else url.searchParams.delete('room');
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* ignore */
    }
  }, [view, roomState?.id]);

  const inRoom = view === 'room' && roomState;
  const inGame = inRoom && roomState.phase !== 'lobby';
  const isRelay = !!inRoom && roomState.config.mode === 'relay';

  return (
    <div className="app">
      {!inRoom && <HomePage />}
      {inRoom && !inGame && <RoomView />}
      {inGame && (isRelay ? <RelayView /> : <GameView />)}
      {name && !connected && view === 'room' && (
        <div className="conn-banner">连接已断开,正在重连…</div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
