import { useStore } from '../store';
import { buildRoomShareUrl, copyText } from '../utils';

/** 分享当前房间:直接复制链接到剪贴板 */
export function ShareButton({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const roomPassword = useStore((s) => s.roomPassword);
  const showToast = useStore((s) => s.showToast);
  if (!roomState) return null;
  const roomId = roomState.id;
  const isPrivate = roomState.config.private;

  const doShare = async (): Promise<void> => {
    // 私密房间的链接带上密码,好友点开可直达
    const url = buildRoomShareUrl(roomId, isPrivate ? roomPassword : null);
    const ok = await copyText(url);
    const tip = isPrivate ? '(含密码)' : '';
    showToast(ok ? `房间链接已复制${tip},发给好友吧 🔗` : `分享链接:${url}`);
  };

  return (
    <button className="btn btn-primary btn-sm" onClick={() => void doShare()} title="分享房间给好友">
      🔗 {compact ? '分享' : '分享房间'}
    </button>
  );
}
