import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CATEGORY_HINT_SECONDS_MAX,
  CATEGORY_HINT_SECONDS_MIN,
  CATEGORY_HINT_SECONDS_STEP,
  DEFAULT_CONFIG,
  DRAW_SECONDS_MAX,
  DRAW_SECONDS_MIN,
  DRAW_SECONDS_STEP,
  MAX_PLAYERS_CHOICES,
  NAME_MAX_LEN,
  RELAY_MAX_PLAYERS_CHOICES,
  RELAY_MIN_PLAYERS,
  ROUNDS_CHOICES,
  WORD_OPTION_COUNT_CHOICES,
  type GameMode,
} from '@draw-guess/shared';
import { useStore } from '../store';
import { createRoom, enterGame, joinRoom, refreshRooms, socket } from '../socket';
import { ThemeToggle } from './ThemeToggle';

export function HomePage(): JSX.Element {
  const savedName = useStore((s) => s.name);
  const connected = useStore((s) => s.connected);
  const rooms = useStore((s) => s.rooms);
  const showToast = useStore((s) => s.showToast);
  const setPendingRoomId = useStore((s) => s.setPendingRoomId);
  // 分享进房号只在进入首页时消费一次:立即从 store 取出并清空,避免离开房间后被重复自动拉回
  const [invitedRoom] = useState(() => useStore.getState().pendingRoomId);

  const [nameInput, setNameInput] = useState(savedName);
  const [joinCode, setJoinCode] = useState(invitedRoom ?? '');
  const [mode, setMode] = useState<GameMode>(DEFAULT_CONFIG.mode);
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_CONFIG.maxPlayers);
  const [rounds, setRounds] = useState(DEFAULT_CONFIG.rounds);
  const [drawSeconds, setDrawSeconds] = useState(DEFAULT_CONFIG.drawSeconds);
  const [categoryHintSeconds, setCategoryHintSeconds] = useState(DEFAULT_CONFIG.categoryHintSeconds);
  const [wordOptionCount, setWordOptionCount] = useState(DEFAULT_CONFIG.wordOptionCount);

  const maxPlayersChoices = mode === 'relay' ? RELAY_MAX_PLAYERS_CHOICES : MAX_PLAYERS_CHOICES;
  const switchMode = (m: GameMode): void => {
    setMode(m);
    // 切换模式后把人数上限归到该模式的合法默认值
    if (m === 'relay' && !RELAY_MAX_PLAYERS_CHOICES.includes(maxPlayers)) setMaxPlayers(8);
    if (m === 'classic' && !MAX_PLAYERS_CHOICES.includes(maxPlayers)) setMaxPlayers(DEFAULT_CONFIG.maxPlayers);
  };

  // 进入首页即连接(已有昵称时),并周期刷新房间列表
  useEffect(() => {
    if (savedName && !socket.connected) enterGame(savedName);
  }, [savedName]);

  useEffect(() => {
    if (!connected) return;
    refreshRooms();
    const t = setInterval(refreshRooms, 3000);
    return () => clearInterval(t);
  }, [connected]);

  // 消费掉分享进房号(仅本次首页有效)
  useEffect(() => {
    if (invitedRoom) setPendingRoomId(null);
  }, [invitedRoom, setPendingRoomId]);

  // 通过分享链接进入且已有昵称时,连接后自动加入对应房间(仅尝试一次)
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current || !invitedRoom || !savedName || !connected) return;
    autoJoinedRef.current = true;
    joinRoom(invitedRoom);
  }, [connected, savedName, invitedRoom]);

  const ensureName = (): boolean => {
    const name = nameInput.trim().slice(0, NAME_MAX_LEN);
    if (!name) {
      showToast('请先输入昵称');
      return false;
    }
    enterGame(name);
    return true;
  };

  const handleCreate = (): void => {
    if (!ensureName()) return;
    // 连接握手是异步的,稍等 hello 完成
    waitConnected(() =>
      createRoom({ mode, maxPlayers, rounds, drawSeconds, categoryHintSeconds, wordOptionCount }),
    );
  };

  const handleJoin = (roomId: string): void => {
    if (!ensureName()) return;
    if (!roomId.trim()) {
      showToast('请输入房间号');
      return;
    }
    waitConnected(() => joinRoom(roomId.trim()));
  };

  return (
    <div className="home">
      <div className="home-topbar">
        <ThemeToggle />
      </div>
      <header className="home-hero">
        <h1>🎨 你画我猜</h1>
        <p className="home-sub">Draw &amp; Guess · 免登录 · 手机电脑同乐</p>
      </header>

      {invitedRoom && (
        <div className="invite-banner">
          🔗 有人邀请你加入房间 <strong>#{invitedRoom}</strong>
          {savedName ? ',正在进入…' : ',输入昵称后即可加入'}
        </div>
      )}

      <div className="home-grid">
        <section className="card">
          <h2>我的昵称</h2>
          <input
            className="input name-input"
            value={nameInput}
            maxLength={NAME_MAX_LEN}
            placeholder="输入昵称,例如:灵魂画手"
            onChange={(e) => setNameInput(e.target.value)}
          />

          <h2>创建房间</h2>
          <ConfigRow label="模式">
            <button
              className={`seg ${mode === 'classic' ? 'seg-on' : ''}`}
              onClick={() => switchMode('classic')}
            >
              🎨 经典
            </button>
            <button
              className={`seg ${mode === 'relay' ? 'seg-on' : ''}`}
              onClick={() => switchMode('relay')}
            >
              🔗 接龙
            </button>
          </ConfigRow>
          {mode === 'relay' && (
            <p className="mode-hint">
              接龙:{RELAY_MIN_PLAYERS}~16 人,轮流「看词作画 → 看画猜词」传一条链,结束回放整链看跑偏了多少 😆
            </p>
          )}
          <ConfigRow label="人数上限">
            {maxPlayersChoices.map((n) => (
              <button
                key={n}
                className={`seg ${maxPlayers === n ? 'seg-on' : ''}`}
                onClick={() => setMaxPlayers(n)}
              >
                {n}
              </button>
            ))}
          </ConfigRow>
          {mode === 'classic' && (
            <ConfigRow label="轮数">
              {ROUNDS_CHOICES.map((n) => (
                <button
                  key={n}
                  className={`seg ${rounds === n ? 'seg-on' : ''}`}
                  onClick={() => setRounds(n)}
                >
                  {n} 轮
                </button>
              ))}
            </ConfigRow>
          )}
          <ConfigRow label={mode === 'relay' ? '作画时长' : '猜词时长'}>
            <Stepper
              value={drawSeconds}
              min={DRAW_SECONDS_MIN}
              max={DRAW_SECONDS_MAX}
              step={DRAW_SECONDS_STEP}
              render={(v) => `${v} 秒`}
              onChange={setDrawSeconds}
            />
          </ConfigRow>
          {mode === 'classic' && (
            <>
              <ConfigRow label="类型提示">
                <Stepper
                  value={categoryHintSeconds}
                  min={CATEGORY_HINT_SECONDS_MIN}
                  max={CATEGORY_HINT_SECONDS_MAX}
                  step={CATEGORY_HINT_SECONDS_STEP}
                  render={(v) => (v === 0 ? '立即显示' : `${v} 秒后显示`)}
                  onChange={setCategoryHintSeconds}
                />
              </ConfigRow>
              <ConfigRow label="候选词数">
                {WORD_OPTION_COUNT_CHOICES.map((n) => (
                  <button
                    key={n}
                    className={`seg ${wordOptionCount === n ? 'seg-on' : ''}`}
                    onClick={() => setWordOptionCount(n)}
                  >
                    {n} 个
                  </button>
                ))}
              </ConfigRow>
            </>
          )}
          <button className="btn btn-primary btn-big" onClick={handleCreate}>
            创建{mode === 'relay' ? '接龙' : ''}房间
          </button>
        </section>

        <section className="card">
          <h2>加入房间</h2>
          <div className="join-row">
            <input
              className="input"
              value={joinCode}
              inputMode="numeric"
              placeholder="输入 6 位房间号"
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin(joinCode)}
            />
            <button className="btn btn-primary" onClick={() => handleJoin(joinCode)}>
              加入
            </button>
          </div>

          <div className="room-list-head">
            <h2>公开房间</h2>
            <button className="btn btn-ghost btn-sm" onClick={refreshRooms}>
              刷新
            </button>
          </div>
          <div className="room-list">
            {rooms.length === 0 && <div className="empty">暂无房间,快创建一个吧</div>}
            {rooms.map((r) => (
              <div key={r.id} className="room-item">
                <div className="room-item-info">
                  <span className="room-item-host">{r.hostName} 的房间</span>
                  <span className="room-item-meta">
                    #{r.id} · {r.playerCount}/{r.maxPlayers} 人 ·{' '}
                    {r.phase === 'lobby' ? '等待中' : '游戏中'}
                  </span>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={r.phase !== 'lobby' || r.playerCount >= r.maxPlayers}
                  onClick={() => handleJoin(r.id)}
                >
                  {r.phase === 'lobby' ? '加入' : '进行中'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer className="home-foot">同一局域网内,手机访问电脑的 LAN 地址即可一起玩</footer>
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="config-row">
      <span className="config-label">{label}</span>
      <div className="seg-group">{children}</div>
    </div>
  );
}

function Stepper(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  render(v: number): string;
  onChange(v: number): void;
}): JSX.Element {
  const { value, min, max, step, render, onChange } = props;
  return (
    <div className="stepper">
      <button
        className="stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label="减少"
      >
        −
      </button>
      <span className="stepper-val">{render(value)}</span>
      <button
        className="stepper-btn"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label="增加"
      >
        +
      </button>
    </div>
  );
}

/** 等待 socket 连上再执行(首次进入时 hello 需要一点时间) */
function waitConnected(fn: () => void, tries = 40): void {
  if (socket.connected) {
    fn();
    return;
  }
  if (tries <= 0) {
    useStore.getState().showToast('连接服务器失败,请稍后重试');
    return;
  }
  setTimeout(() => waitConnected(fn, tries - 1), 100);
}
