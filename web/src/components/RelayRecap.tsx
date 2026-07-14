import { useStore } from '../store';
import { leaveRoom, playAgain } from '../socket';
import { avatarFor } from '../utils';
import { StrokesCanvas } from './StrokesCanvas';

/** 接龙结算:整链回放 + 首尾对比 */
export function RelayRecapView({ isHost }: { isHost: boolean }): JSX.Element {
  const recap = useStore((s) => s.relayRecap);

  if (!recap) {
    return (
      <div className="relay-waiting">
        <div className="relay-waiting-emoji">🏁</div>
        <h3>接龙结束,正在加载回放…</h3>
      </div>
    );
  }

  return (
    <div className="relay-recap card">
      <div className={`relay-verdict ${recap.success ? 'ok' : 'drift'}`}>
        {recap.success ? '🎉 接龙成功!首尾词一致,全队得分!' : '😆 一路跑偏!这就是接龙的乐趣'}
      </div>

      <div className="relay-headtail">
        <div className="relay-ht-item">
          <span className="relay-ht-label">原始词</span>
          <span className="relay-ht-word">{recap.seed}</span>
        </div>
        <span className="relay-ht-arrow">→</span>
        <div className="relay-ht-item">
          <span className="relay-ht-label">最终猜词</span>
          <span className={`relay-ht-word ${recap.success ? 'ok' : 'drift'}`}>
            {recap.finalGuess ?? '(无)'}
          </span>
        </div>
      </div>

      <div className="relay-chain">
        <div className="relay-step seed">
          <div className="relay-step-tag">🌱 原始词</div>
          <div className="relay-step-word">{recap.seed}</div>
        </div>
        {recap.links.map((link, i) => (
          <div key={i} className={`relay-step ${link.kind}`}>
            <div className="relay-step-tag">
              {avatarFor(link.playerId)} {link.name} {link.kind === 'draw' ? '画的' : '猜的'}
            </div>
            {link.kind === 'draw' ? (
              <div className="relay-step-canvas-wrap">
                <StrokesCanvas strokes={link.strokes} className="gallery-canvas" />
              </div>
            ) : (
              <div className="relay-step-word">{link.word}</div>
            )}
          </div>
        ))}
      </div>

      <div className="rank-actions">
        {isHost ? (
          <button className="btn btn-primary btn-big" onClick={playAgain}>
            再来一局
          </button>
        ) : (
          <p className="overlay-tip">等待房主开启下一局…</p>
        )}
        <button className="btn btn-ghost" onClick={leaveRoom}>
          离开房间
        </button>
      </div>
    </div>
  );
}
