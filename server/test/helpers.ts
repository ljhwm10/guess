import type { RoomState, ServerToClientEvents } from '@draw-guess/shared';
import type { Clock, RoomIO } from '../src/room';

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private t = 1_000_000;
  private timers: FakeTimer[] = [];
  private seq = 0;

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }

  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== h);
  }

  /** 推进虚拟时间,按到期顺序触发定时器(含链式新增的) */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      due.fn();
    }
    this.t = target;
  }
}

export interface SentEvent {
  playerId: string;
  event: keyof ServerToClientEvents;
  args: unknown[];
}

export class FakeIO implements RoomIO {
  events: SentEvent[] = [];

  send<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.events.push({ playerId, event, args });
  }

  of(playerId: string, event: keyof ServerToClientEvents): SentEvent[] {
    return this.events.filter((e) => e.playerId === playerId && e.event === event);
  }

  last(playerId: string, event: keyof ServerToClientEvents): SentEvent | undefined {
    const list = this.of(playerId, event);
    return list[list.length - 1];
  }

  lastState(playerId: string): RoomState | undefined {
    return this.last(playerId, 'room:state')?.args[0] as RoomState | undefined;
  }

  clear(): void {
    this.events = [];
  }
}
