import { useStore } from '../store';
import { buildRoomShareUrl, copyText } from '../utils';

/** 分享当前房间:直接复制链接到剪贴板 */
export function ShareButton({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const showToast = useStore((s) => s.showToast);
  if (!roomState) return null;
  const roomId = roomState.id;

  const doShare = async (): Promise<void> => {
    const url = buildRoomShareUrl(roomId);
    // 直接复制链接到剪贴板，不触发系统分享面板（iOS 兼容）
    const ok = await copyText(url);
    showToast(ok ? '房间链接已复制,发给好友吧 🔗' : `分享链接:${url}`);
  };

  return (
    <button className="btn btn-primary btn-sm" onClick={() => void doShare()} title="分享房间给好友">
      🔗 {compact ? '分享' : '分享房间'}
    </button>
  );
}
