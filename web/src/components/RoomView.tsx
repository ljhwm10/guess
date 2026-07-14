import { useState } from 'react';
import { MIN_PLAYERS, RELAY_MIN_PLAYERS } from '@draw-guess/shared';
import { useMe, useStore } from '../store';
import { leaveRoom, moveSeat, setReady, startGame } from '../socket';
import { avatarFor, copyText } from '../utils';
import { ChatPanel } from './ChatPanel';
import { VoiceBar } from './VoiceBar';
import { ShareButton } from './ShareButton';
import { ThemeToggle } from './ThemeToggle';
import { Spinner } from './Spinner';

/** 房间等待界面(lobby) */
export function RoomView(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const { id: myId, isHost } = useMe();
  const showToast = useStore((s) => s.showToast);
  const [starting, setStarting] = useState(false);
  if (!roomState) return null;

  const me = roomState.players.find((p) => p.id === myId);
  const mySeated = me ? me.seat !== null : false;
  const seatedPlayers = roomState.players.filter((p) => p.seat !== null);
  const benched = roomState.players.filter((p) => p.seat === null);
  const seatedOthers = seatedPlayers.filter((p) => p.id !== roomState.hostId);
  const allReady = seatedOthers.length > 0 && seatedOthers.every((p) => p.ready);
  const isRelay = roomState.config.mode === 'relay';
  const minPlayers = isRelay ? RELAY_MIN_PLAYERS : MIN_PLAYERS;
  const canStart = isHost && seatedPlayers.length >= minPlayers && allReady;
  const seatArr = Array.from(
    { length: roomState.config.maxPlayers },
    (_, i) => roomState.players.find((p) => p.seat === i) ?? null,
  );

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
          <div className="room-players-scroll">
          <h2>
            座位 {seatedPlayers.length}/{roomState.config.maxPlayers}
            <span className="seat-hint">（出场顺序按座位;点空位入座/换位）</span>
          </h2>
          <div className="lobby-grid">
            {seatArr.map((p, i) =>
              p ? (
                <div key={p.id} className={`lobby-player ${!p.online ? 'offline' : ''}`}>
                  <div className="seat-no">{i + 1}</div>
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
              ) : (
                <button
                  key={`seat-${i}`}
                  className="lobby-player lobby-empty seat-open"
                  onClick={() => moveSeat(i)}
                  title="点击入座"
                >
                  <div className="seat-no">{i + 1}</div>
                  <div className="lobby-avatar">➕</div>
                  <div className="lobby-name">点击入座</div>
                </button>
              ),
            )}
          </div>

          <div className="bench-head">
            <h2>🪑 备战席 {benched.length > 0 ? `(${benched.length})` : ''}</h2>
            {mySeated && (
              <button className="btn btn-ghost btn-sm" onClick={() => moveSeat(null)}>
                下场观战
              </button>
            )}
          </div>
          <div className="bench-row">
            {benched.length === 0 && <span className="empty">暂无观战玩家</span>}
            {benched.map((p) => (
              <div key={p.id} className={`bench-player ${!p.online ? 'offline' : ''}`}>
                <span className="bench-avatar">{avatarFor(p.id)}</span>
                <span className="bench-name">
                  {p.isHost && '👑'}
                  {p.name}
                  {p.id === myId && ' (我)'}
                </span>
              </div>
            ))}
          </div>
          </div>

          <div className="lobby-actions">
            {isHost ? (
              <button
                className="btn btn-primary btn-big"
                disabled={!canStart || starting}
                onClick={() => {
                  setStarting(true);
                  startGame(() => setStarting(false));
                }}
              >
                {starting ? (
                  <>
                    <Spinner />
                    开始中…
                  </>
                ) : canStart ? (
                  '开始游戏'
                ) : seatedPlayers.length < minPlayers ? (
                  `至少 ${minPlayers} 名在座玩家才能开始`
                ) : (
                  '等待在座玩家准备…'
                )}
              </button>
            ) : !mySeated ? (
              <div className="bench-tip">👀 你在备战席,点上方空位入座即可参战</div>
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
