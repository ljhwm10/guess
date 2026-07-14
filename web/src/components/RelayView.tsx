import { useEffect, useState } from 'react';
import { PEN_COLORS, PEN_WIDTHS, ERASER_WIDTHS, type Tool } from '@draw-guess/shared';
import { useMe, useStore } from '../store';
import { leaveRoom, relayDone, relaySubmitGuess } from '../socket';
import { CanvasBoard } from './CanvasBoard';
import { Toolbar } from './Toolbar';
import { PlayerList } from './PlayerList';
import { VoiceBar } from './VoiceBar';
import { ShareButton } from './ShareButton';
import { ThemeToggle } from './ThemeToggle';
import { StrokesCanvas } from './StrokesCanvas';
import { RelayRecapView } from './RelayRecap';
import { avatarFor } from '../utils';

export function RelayView(): JSX.Element | null {
  const roomState = useStore((s) => s.roomState);
  const relayTask = useStore((s) => s.relayTask);
  const { id: myId, isHost } = useMe();

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1]);
  const [eraserWidth, setEraserWidth] = useState(ERASER_WIDTHS[1]);

  if (!roomState) return null;
  const phase = roomState.phase;
  const relay = roomState.relay;
  const isActive = relay?.activeId === myId;

  return (
    <div className="game">
      <header className="game-head">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm('确定离开当前接龙吗?')) leaveRoom();
          }}
        >
          ← 离开
        </button>
        <ShareButton compact />
        {relay && (
          <div className="game-round">
            接龙 第 {relay.step}/{relay.totalSteps} 步
          </div>
        )}
        <div className="word-bar">
          {phase === 'gameEnd' ? (
            <span className="word-reveal">🏁 接龙结束</span>
          ) : (
            <span className="relay-active-label">
              {relay ? (
                <>
                  {avatarFor(relay.activeId)} <strong>{relay.activeName}</strong>
                  {relay.kind === 'draw' ? ' 正在作画…' : ' 正在猜词…'}
                </>
              ) : (
                '接龙进行中'
              )}
            </span>
          )}
        </div>
        <Timer endsAt={roomState.timerEndsAt} />
        <ThemeToggle />
      </header>

      <div className="game-main">
        <aside className="game-side card">
          <PlayerList />
          <VoiceBar />
        </aside>

        <div className="game-center">
          {phase === 'gameEnd' ? (
            <RelayRecapView isHost={isHost} />
          ) : isActive && relayTask ? (
            relayTask.kind === 'draw' ? (
              <RelayDrawActive
                prompt={relayTask.prompt}
                tool={tool}
                color={color}
                penWidth={penWidth}
                eraserWidth={eraserWidth}
                onTool={setTool}
                onColor={setColor}
                onPenWidth={setPenWidth}
                onEraserWidth={setEraserWidth}
              />
            ) : (
              <RelayGuessActive strokes={relayTask.strokes} />
            )
          ) : (
            <RelayWaiting />
          )}
        </div>
      </div>
    </div>
  );
}

/** 作画环节:当前玩家作画,顶部私密提示要画的词 */
function RelayDrawActive(props: {
  prompt: string;
  tool: Tool;
  color: string;
  penWidth: number;
  eraserWidth: number;
  onTool(t: Tool): void;
  onColor(c: string): void;
  onPenWidth(w: number): void;
  onEraserWidth(w: number): void;
}): JSX.Element {
  const { prompt, tool, color, penWidth, eraserWidth } = props;
  return (
    <>
      <div className="relay-prompt">
        ✏️ 请画出:<strong>{prompt}</strong>
        <span className="relay-prompt-tip">(只能用图形,别写字哦)</span>
      </div>
      <div className="canvas-outer">
        <CanvasBoard
          canDraw
          tool={tool}
          color={color}
          width={tool === 'eraser' ? eraserWidth : penWidth}
        />
      </div>
      <Toolbar
        tool={tool}
        color={color}
        penWidth={penWidth}
        eraserWidth={eraserWidth}
        onTool={props.onTool}
        onColor={props.onColor}
        onPenWidth={props.onPenWidth}
        onEraserWidth={props.onEraserWidth}
      />
      <button className="btn btn-primary btn-big" onClick={relayDone}>
        ✅ 画好了,传给下家
      </button>
    </>
  );
}

/** 猜词环节:当前玩家看上一环的画,写下猜的词 */
function RelayGuessActive({ strokes }: { strokes: Parameters<typeof StrokesCanvas>[0]['strokes'] }): JSX.Element {
  const [word, setWord] = useState('');
  const submit = (): void => {
    const w = word.trim();
    if (!w) return;
    relaySubmitGuess(w, () => setWord(''));
  };
  return (
    <>
      <div className="relay-prompt">🤔 上一位画的是什么?写下你的猜测</div>
      <div className="canvas-outer">
        <div className="canvas-wrap">
          <StrokesCanvas strokes={strokes} className="board" />
        </div>
      </div>
      <div className="relay-guess-row">
        <input
          className="input"
          value={word}
          maxLength={20}
          placeholder="输入你猜的词…"
          autoFocus
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="btn btn-primary" onClick={submit}>
          提交
        </button>
      </div>
    </>
  );
}

/** 等待其他玩家操作 */
function RelayWaiting(): JSX.Element {
  const relay = useStore((s) => s.roomState?.relay);
  return (
    <div className="relay-waiting">
      <div className="relay-waiting-emoji">{relay?.kind === 'draw' ? '🎨' : '🤔'}</div>
      <h3>
        {relay ? `${relay.activeName} 正在${relay.kind === 'draw' ? '作画' : '猜词'}…` : '接龙进行中…'}
      </h3>
      <p className="overlay-tip">轮到你时会自动切换,先和大家开麦聊聊吧 🎙️</p>
    </div>
  );
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
