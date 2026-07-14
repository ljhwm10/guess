import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './store';

// 路由懒加载：将具名导出转换为默认导出（React.lazy 要求）
const HomePage = lazy(() => import('./components/HomePage').then(m => ({ default: m.HomePage })));
const RoomView = lazy(() => import('./components/RoomView').then(m => ({ default: m.RoomView })));
const GameView = lazy(() => import('./components/GameView').then(m => ({ default: m.GameView })));
const RelayView = lazy(() => import('./components/RelayView').then(m => ({ default: m.RelayView })));

// 品牌化加载占位(极少出现:分包已在空闲时预取)
function LoadingFallback() {
  return (
    <div className="loading">
      <div className="loading-spinner" aria-hidden />
    </div>
  );
}

export function App(): JSX.Element {
  const view = useStore((s) => s.view);
  const roomState = useStore((s) => s.roomState);
  const connected = useStore((s) => s.connected);
  const name = useStore((s) => s.name);
  const toast = useStore((s) => s.toast);

  // 空闲时预取房间/游戏分包,进房时基本不会再出现"加载中"闪屏
  useEffect(() => {
    const prefetch = (): void => {
      void import('./components/RoomView');
      void import('./components/GameView');
      void import('./components/RelayView');
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (ric) ric(prefetch);
    else setTimeout(prefetch, 1200);
  }, []);

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
      <Suspense fallback={<LoadingFallback />}>
        {!inRoom && <HomePage />}
        {inRoom && !inGame && <RoomView />}
        {inGame && (isRelay ? <RelayView /> : <GameView />)}
        {name && !connected && view === 'room' && (
          <div className="conn-banner">连接已断开,正在重连…</div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </Suspense>
    </div>
  );
}
