import { MIN_PLAYERS, RELAY_MIN_PLAYERS } from '@draw-guess/shared';
import { useMe, useStore } from '../store';
import { leaveRoom, setReady, startGame } from '../socket';
import { avatarFor, copyText } from '../utils';
import { ChatPanel } from './ChatPanel';
import { VoiceBar } from './VoiceBar';
import { ShareButton } from './ShareButton';
import { ThemeToggle } from './ThemeToggle';

/** 房间等待界面(lobby) */
export function RoomView(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const { id: myId, isHost } = useMe();
  const showToast = useStore((s) => s.showToast);
  if (!roomState) return null;

  const me = roomState.players.find((p) => p.id === myId);
  const others = roomState.players.filter((p) => p.id !== roomState.hostId);
  const allReady = others.length > 0 && others.every((p) => p.ready);
  const isRelay = roomState.config.mode === 'relay';
  const minPlayers = isRelay ? RELAY_MIN_PLAYERS : MIN_PLAYERS;
  const canStart = isHost && roomState.players.length >= minPlayers && allReady;

  const copyCode = (): void => {
    void copyText(roomState.id).then((ok) =>
      showToast(ok ? '房间号已复制' : `房间号:${roomState.id}`),
    );
  };

  return (
    <div className="room">
      <header className="room-head">
        <button className="btn btn-ghost btn-sm" onClick={leaveRoom}>
          ← 离开
        </button>
        <div className="room-code" onClick={copyCode} title="点击复制">
          房间号 <strong>{roomState.id}</strong> 📋
        </div>
        <ShareButton />
        <div className="room-config-tags">
          <span className="tag tag-mode">{isRelay ? '🔗 接龙' : '🎨 经典'}</span>
          <span className="tag">{roomState.config.maxPlayers} 人</span>
          {isRelay ? (
            <span className="tag">作画 {roomState.config.drawSeconds} 秒</span>
          ) : (
            <>
              <span className="tag">{roomState.config.rounds} 轮</span>
              <span className="tag">{roomState.config.drawSeconds} 秒</span>
              <span className="tag">{roomState.config.wordOptionCount} 选词</span>
              <span className="tag">
                提示{roomState.config.categoryHintSeconds === 0 ? '立即' : ` ${roomState.config.categoryHintSeconds}s`}
              </span>
            </>
          )}
        </div>
        <ThemeToggle />
      </header>

      <div className="room-body">
        <section className="card room-players">
          <h2>
            玩家 {roomState.players.length}/{roomState.config.maxPlayers}
          </h2>
          <div className="lobby-grid">
            {roomState.players.map((p) => (
              <div key={p.id} className={`lobby-player ${!p.online ? 'offline' : ''}`}>
                <div className="lobby-avatar">{avatarFor(p.id)}</div>
                <div className="lobby-name">
                  {p.isHost && '👑 '}
                  {p.name}
                  {p.id === myId && ' (我)'}
                </div>
                <div className={`lobby-ready ${p.isHost ? '' : p.ready ? 'ok' : 'no'}`}>
                  {p.isHost ? '房主' : p.ready ? '已准备' : '未准备'}
                </div>
              </div>
            ))}
            {Array.from({ length: roomState.config.maxPlayers - roomState.players.length }).map(
              (_, i) => (
                <div key={`empty-${i}`} className="lobby-player lobby-empty">
                  <div className="lobby-avatar">➕</div>
                  <div className="lobby-name">等待加入</div>
                </div>
              ),
            )}
          </div>

          <div className="lobby-actions">
            {isHost ? (
              <button className="btn btn-primary btn-big" disabled={!canStart} onClick={startGame}>
                {canStart
                  ? '开始游戏'
                  : roomState.players.length < minPlayers
                    ? `至少 ${minPlayers} 人才能开始`
                    : '等待全员准备…'}
              </button>
            ) : me?.ready ? (
              <button className="btn btn-warn btn-big" onClick={() => setReady(false)}>
                取消准备
              </button>
            ) : (
              <button className="btn btn-primary btn-big" onClick={() => setReady(true)}>
                准备
              </button>
            )}
          </div>
          <VoiceBar />
        </section>

        <section className="card room-chat">
          <h2>聊天</h2>
          <ChatPanel placeholder="和大家打个招呼吧…" />
        </section>
      </div>
    </div>
  );
}
