import { useEffect, useState } from 'react';
import { PEN_COLORS, PEN_WIDTHS, ERASER_WIDTHS, type Tool, type TurnRecord } from '@draw-guess/shared';
import { useMe, useStore } from '../store';
import { chooseWord, leaveRoom, playAgain, refreshWords } from '../socket';
import { CanvasBoard } from './CanvasBoard';
import { Toolbar } from './Toolbar';
import { PlayerList } from './PlayerList';
import { ChatPanel } from './ChatPanel';
import { VoiceBar } from './VoiceBar';
import { ShareButton } from './ShareButton';
import { ThemeToggle } from './ThemeToggle';
import { StrokesCanvas } from './StrokesCanvas';
import { avatarFor } from '../utils';

export function GameView(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const word = useStore((s) => s.word);
  const wordOptions = useStore((s) => s.wordOptions);
  const wordRefreshLeft = useStore((s) => s.wordRefreshLeft);
  const { id: myId, isHost, isDrawer } = useMe();

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1]);
  const [eraserWidth, setEraserWidth] = useState(ERASER_WIDTHS[1]);
  // "换一批"发出后到新列表到达前,禁用旧列表防止误选
  const [refreshPending, setRefreshPending] = useState(false);

  // 轮到自己画时重置为画笔
  useEffect(() => {
    if (isDrawer && roomState?.phase === 'choosing') setTool('pen');
  }, [isDrawer, roomState?.phase]);

  // 新候选词到达即解除 pending
  useEffect(() => {
    setRefreshPending(false);
  }, [wordOptions]);

  if (!roomState) return null;
  const phase = roomState.phase;
  const canDraw = isDrawer && phase === 'drawing';
  const drawer = roomState.players.find((p) => p.id === roomState.drawerId);

  return (
    <div className="game">
      <header className="game-head">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm('确定离开当前对局吗?')) leaveRoom();
          }}
        >
          ← 离开
        </button>
        <ShareButton compact />
        <div className="game-round">
          第 {roomState.round}/{roomState.totalRounds} 轮 · {roomState.turnInRound}/
          {roomState.turnsPerRound}
        </div>
        <WordBar
          phase={phase}
          isDrawer={isDrawer}
          word={word}
          hint={roomState.wordHint}
          category={roomState.wordCategory}
          drawerName={drawer?.name ?? ''}
        />
        <Timer endsAt={roomState.timerEndsAt} />
        <ThemeToggle />
      </header>

      <div className="game-main">
        <aside className="game-side card">
          <PlayerList />
          <VoiceBar />
        </aside>

        <div className="game-center">
          <div className="canvas-outer">
            <CanvasBoard
              canDraw={canDraw}
              tool={tool}
              color={color}
              width={tool === 'eraser' ? eraserWidth : penWidth}
            />
            {phase === 'choosing' && (
              <div className="overlay">
                {isDrawer && wordOptions ? (
                  <div className="overlay-card">
                    <h3>选择一个词开始作画</h3>
                    <div className="word-options">
                      {wordOptions.map((w, i) => (
                        <button
                          key={w.text}
                          className="word-option"
                          disabled={refreshPending}
                          onClick={() => chooseWord(i, w.text)}
                        >
                          <span className="word-text">{w.text}</span>
                          <span className="word-hint">{w.hint}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      className="btn btn-sm btn-ghost word-refresh"
                      disabled={wordRefreshLeft <= 0 || refreshPending}
                      onClick={() => {
                        setRefreshPending(true);
                        refreshWords((ok) => {
                          if (!ok) setRefreshPending(false);
                        });
                      }}
                    >
                      🔄{' '}
                      {refreshPending
                        ? '正在换词…'
                        : wordRefreshLeft > 0
                          ? `换一批(剩 ${wordRefreshLeft} 次)`
                          : '换一批(已用完)'}
                    </button>
                  </div>
                ) : (
                  <div className="overlay-card">
                    <div className="overlay-avatar">{drawer ? avatarFor(drawer.id) : '🎨'}</div>
                    <h3>{drawer?.name ?? '画者'} 正在选词…</h3>
                  </div>
                )}
              </div>
            )}
            {phase === 'turnEnd' && roomState.turnResult && (
              <TurnEndOverlay />
            )}
            {phase === 'gameEnd' && roomState.ranking && (
              <GameEndOverlay myId={myId} isHost={isHost} />
            )}
          </div>
          {canDraw && (
            <Toolbar
              tool={tool}
              color={color}
              penWidth={penWidth}
              eraserWidth={eraserWidth}
              onTool={setTool}
              onColor={setColor}
              onPenWidth={setPenWidth}
              onEraserWidth={setEraserWidth}
            />
          )}
        </div>

        <section className="game-chat card">
          <ChatPanel placeholder={isDrawer ? '和大家聊聊(不能剧透哦)' : '输入你的猜测…'} />
        </section>
      </div>
    </div>
  );
}

function WordBar(props: {
  phase: string;
  isDrawer: boolean;
  word: string | null;
  hint: string | null;
  category: string | null;
  drawerName: string;
}): JSX.Element {
  const { phase, isDrawer, word, hint, category } = props;
  if (phase === 'drawing') {
    if (isDrawer || word) {
      return (
        <div className="word-bar">
          {category && <span className="tag tag-cat">{category}</span>}
          <span className="word-reveal">{word}</span>
        </div>
      );
    }
    return (
      <div className="word-bar">
        {/* 类型提示到点(categoryHintSeconds)后由服务端下发 */}
        {category && <span className="tag tag-cat">{category}</span>}
        <span className="word-mask">{hint && [...hint].join(' ')}</span>
      </div>
    );
  }
  if (phase === 'choosing') return <div className="word-bar">✏️ 选词中</div>;
  return <div className="word-bar" />;
}

function Timer({ endsAt }: { endsAt: number | null }): JSX.Element | null {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return <div className="timer" />;
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return <div className={`timer ${left <= 10 ? 'timer-hot' : ''}`}>⏱ {left}</div>;
}

function TurnEndOverlay(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  if (!roomState?.turnResult) return null;
  const { word, gains, reason } = roomState.turnResult;
  const reasonText =
    reason === 'allGuessed' ? '全员猜中!' : reason === 'timeout' ? '时间到!' : '画者离开了';
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h3>{reasonText}</h3>
        <p className="answer-line">
          答案是 <strong className="answer-word">{word || '(未选词)'}</strong>
        </p>
        <div className="gain-list">
          {roomState.players
            .filter((p) => gains[p.id])
            .sort((a, b) => (gains[b.id] ?? 0) - (gains[a.id] ?? 0))
            .map((p) => (
              <div key={p.id} className="gain-row">
                <span>
                  {avatarFor(p.id)} {p.name}
                </span>
                <span className="gain-num">+{gains[p.id]}</span>
              </div>
            ))}
          {Object.keys(gains).length === 0 && <div className="empty">本回合无人得分</div>}
        </div>
        <p className="overlay-tip">即将进入下一回合…</p>
      </div>
    </div>
  );
}

function GameEndOverlay({ myId, isHost }: { myId: string; isHost: boolean }): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const gallery = useStore((s) => s.gallery);
  const [tab, setTab] = useState<'rank' | 'gallery'>('rank');
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  if (!roomState?.ranking) return null;
  const medals = ['🥇', '🥈', '🥉'];
  const turns = gallery ?? [];

  return (
    <div className="overlay">
      <div className="overlay-card rank-card end-card">
        <h3>🏆 游戏结束</h3>
        <div className="end-tabs">
          <button
            className={`end-tab ${tab === 'rank' ? 'on' : ''}`}
            onClick={() => setTab('rank')}
          >
            排名
          </button>
          <button
            className={`end-tab ${tab === 'gallery' ? 'on' : ''}`}
            onClick={() => setTab('gallery')}
            disabled={turns.length === 0}
          >
            🖼 回顾{turns.length ? ` (${turns.length})` : ''}
          </button>
        </div>

        {tab === 'rank' && (
          <div className="rank-list">
            {roomState.ranking.map((r) => (
              <div key={r.playerId} className={`rank-row ${r.playerId === myId ? 'rank-me' : ''}`}>
                <span className="rank-no">{medals[r.rank - 1] ?? `#${r.rank}`}</span>
                <span className="rank-avatar">{avatarFor(r.playerId)}</span>
                <span className="rank-name">{r.name}</span>
                <span className="rank-score">{r.score} 分</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'gallery' && (
          <div className="gallery-grid">
            {turns.length === 0 && <div className="empty">本局没有可回顾的回合</div>}
            {turns.map((t, i) => (
              <button key={i} className="gallery-card" onClick={() => setOpenTurn(i)}>
                <div className="gallery-canvas-wrap">
                  <StrokesCanvas strokes={t.strokes} className="gallery-canvas" />
                </div>
                <div className="gallery-meta">
                  <span className="gallery-word">{t.word}</span>
                  <span className="gallery-sub">
                    {avatarFor(t.drawerId)} {t.drawerName} · {t.correctGuessers.length} 人猜对
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

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

      {openTurn != null && turns[openTurn] && (
        <TurnDetail turn={turns[openTurn]} onClose={() => setOpenTurn(null)} />
      )}
    </div>
  );
}

function TurnDetail({ turn, onClose }: { turn: TurnRecord; onClose: () => void }): JSX.Element {
  return (
    <div className="turn-detail" onClick={onClose}>
      <div className="turn-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="turn-detail-head">
          <span>
            {avatarFor(turn.drawerId)} {turn.drawerName} 画的 · 第 {turn.round} 轮
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="gallery-canvas-wrap">
          <StrokesCanvas strokes={turn.strokes} className="gallery-canvas" />
        </div>
        <p className="turn-detail-word">
          答案:<strong className="answer-word">{turn.word}</strong>
        </p>
        <div className="gain-list">
          {turn.correctGuessers.length === 0 ? (
            <div className="empty">本回合无人猜中</div>
          ) : (
            turn.correctGuessers.map((g) => (
              <div key={g.playerId} className="gain-row">
                <span>
                  {avatarFor(g.playerId)} {g.name}
                </span>
                <span className="gain-num">+{g.gain}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
