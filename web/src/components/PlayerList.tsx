import { useStore } from '../store';
import { avatarFor } from '../utils';

/** 游戏中玩家侧栏(分数、猜中状态、画者标记) */
export function PlayerList(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const playerId = useStore((s) => s.playerId);
  const voicePeers = useStore((s) => s.voicePeers);
  if (!roomState) return null;

  const sorted = [...roomState.players].sort((a, b) => b.score - a.score);
  const voiceMap = new Map(voicePeers.map((p) => [p.playerId, p.muted]));

  return (
    <div className="player-list">
      {sorted.map((p, i) => (
        <div key={p.id} className={`player-row ${!p.online ? 'offline' : ''}`}>
          <span className="player-rank">{i + 1}</span>
          <span className="player-avatar">{avatarFor(p.id)}</span>
          <span className="player-name">
            {p.name}
            {p.id === playerId && <em> (我)</em>}
          </span>
          <span className="player-badges">
            {p.id === roomState.drawerId && <span title="正在作画">🖌️</span>}
            {p.guessed && <span title="已猜中">✅</span>}
            {voiceMap.has(p.id) && <span title="语音中">{voiceMap.get(p.id) ? '🔇' : '🎙️'}</span>}
            {!p.online && <span title="已掉线">📴</span>}
          </span>
          <span className="player-score">{p.score}</span>
        </div>
      ))}
    </div>
  );
}
