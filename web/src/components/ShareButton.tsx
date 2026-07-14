import { useStore } from '../store';
import { buildRoomShareUrl, copyText } from '../utils';

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

/** 分享当前房间:优先系统分享面板,降级为复制链接(兼容非安全上下文) */
export function ShareButton({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const showToast = useStore((s) => s.showToast);
  if (!roomState) return null;
  const roomId = roomState.id;

  const doShare = async (): Promise<void> => {
    const url = buildRoomShareUrl(roomId);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: '你画我猜', text: `快来和我一起玩你画我猜!房间号 ${roomId}`, url });
        return;
      } catch (e) {
        // 用户主动取消分享则不再复制
        if ((e as { name?: string })?.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url);
    showToast(ok ? '房间链接已复制,发给好友吧 🔗' : `分享链接:${url}`);
  };

  return (
    <button className="btn btn-primary btn-sm" onClick={() => void doShare()} title="分享房间给好友">
      🔗 {compact ? '分享' : '分享房间'}
    </button>
  );
}
