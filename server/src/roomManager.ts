import {
  CATEGORY_HINT_SECONDS_MAX,
  CATEGORY_HINT_SECONDS_MIN,
  DEFAULT_CONFIG,
  DRAW_SECONDS_MAX,
  DRAW_SECONDS_MIN,
  GAME_MODES,
  MAX_PLAYERS_CHOICES,
  RELAY_MAX_PLAYERS_CHOICES,
  ROUNDS_CHOICES,
  WORD_OPTION_COUNT_CHOICES,
  type GameMode,
  type RoomConfig,
  type RoomSummary,
} from '@draw-guess/shared';
import { GameError, Room, systemClock, type Clock, type RoomIO } from './room';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();

  constructor(
    private io: RoomIO,
    private clock: Clock = systemClock,
    private rng: () => number = Math.random,
  ) {}

  getRoomOf(playerId: string): Room | null {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;
    return this.rooms.get(roomId) ?? null;
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  /** 连接握手:若玩家仍在某房间(断线宽限内),自动恢复 */
  hello(playerId: string): boolean {
    const room = this.getRoomOf(playerId);
    if (room && room.hasPlayer(playerId)) {
      room.rejoin(playerId);
      return true;
    }
    if (room) this.playerRoom.delete(playerId);
    return false;
  }

  createRoom(playerId: string, name: string, partial: Partial<RoomConfig>): string {
    if (this.playerRoom.has(playerId)) throw new GameError('你已在其他房间中');
    const config = sanitizeConfig(partial);
    let id = this.genRoomId();
    while (this.rooms.has(id)) id = this.genRoomId();
    const room = new Room(
      id,
      config,
      this.io,
      {
        onPlayerRemoved: (pid) => {
          if (this.playerRoom.get(pid) === id) this.playerRoom.delete(pid);
        },
        onEmpty: () => this.rooms.delete(id),
      },
      this.clock,
      this.rng,
    );
    this.rooms.set(id, room);
    this.playerRoom.set(playerId, id);
    try {
      room.addPlayer(playerId, name);
    } catch (e) {
      this.playerRoom.delete(playerId);
      this.rooms.delete(id);
      throw e;
    }
    return id;
  }

  joinRoom(playerId: string, name: string, roomId: string): void {
    const existing = this.getRoomOf(playerId);
    if (existing) {
      if (existing.id === roomId) return existing.rejoin(playerId);
      throw new GameError('你已在其他房间中');
    }
    const room = this.rooms.get(roomId.trim());
    if (!room) throw new GameError('房间不存在');
    room.addPlayer(playerId, name);
    this.playerRoom.set(playerId, room.id);
  }

  leaveRoom(playerId: string): void {
    const room = this.getRoomOf(playerId);
    if (!room) return;
    room.leave(playerId);
    this.playerRoom.delete(playerId);
  }

  onDisconnect(playerId: string): void {
    const room = this.getRoomOf(playerId);
    if (!room) return;
    room.onDisconnect(playerId);
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      hostName: r.hostName,
      playerCount: r.playerCount,
      maxPlayers: r.config.maxPlayers,
      phase: r.phase,
    }));
  }

  private genRoomId(): string {
    return String(Math.floor(this.rng() * 900000) + 100000);
  }
}

/** 非法/缺失取默认值,数值类按范围钳制到整数 */
export function sanitizeConfig(partial: Partial<RoomConfig> | undefined): RoomConfig {
  const p = partial ?? {};
  const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const mode: GameMode = GAME_MODES.includes(p.mode as GameMode)
    ? (p.mode as GameMode)
    : DEFAULT_CONFIG.mode;
  const maxChoices = mode === 'relay' ? RELAY_MAX_PLAYERS_CHOICES : MAX_PLAYERS_CHOICES;
  const maxPlayers = maxChoices.includes(Number(p.maxPlayers))
    ? Number(p.maxPlayers)
    : mode === 'relay'
      ? 8
      : DEFAULT_CONFIG.maxPlayers;
  const rounds = ROUNDS_CHOICES.includes(Number(p.rounds)) ? Number(p.rounds) : DEFAULT_CONFIG.rounds;
  const drawSeconds = clampInt(p.drawSeconds, DRAW_SECONDS_MIN, DRAW_SECONDS_MAX, DEFAULT_CONFIG.drawSeconds);
  const categoryHintSeconds = clampInt(
    p.categoryHintSeconds,
    CATEGORY_HINT_SECONDS_MIN,
    CATEGORY_HINT_SECONDS_MAX,
    DEFAULT_CONFIG.categoryHintSeconds,
  );
  const wordOptionCount = WORD_OPTION_COUNT_CHOICES.includes(Number(p.wordOptionCount))
    ? Number(p.wordOptionCount)
    : DEFAULT_CONFIG.wordOptionCount;
  return { mode, maxPlayers, rounds, drawSeconds, categoryHintSeconds, wordOptionCount };
}
