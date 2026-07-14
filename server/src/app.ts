import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import {
  NAME_MAX_LEN,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@draw-guess/shared';
import { GameError, systemClock, type RoomIO } from './room';
import { RoomManager } from './roomManager';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Parameters<Parameters<IoServer['on']>[1]>[0];

interface SocketData {
  playerId?: string;
  name?: string;
}

export interface GameServer {
  httpServer: HttpServer;
  io: IoServer;
  manager: RoomManager;
}

export function createGameServer(): GameServer {
  const app = express();
  const httpServer = createServer(app);
  const io: IoServer = new Server(httpServer, {
    cors: { origin: true },
    // 手机锁屏等场景下留足恢复余地
    pingTimeout: 20000,
  });

  /** playerId -> 当前 socket */
  const sockets = new Map<string, IoSocket>();

  const roomIO: RoomIO = {
    send(playerId, event, ...args) {
      sockets.get(playerId)?.emit(event, ...args);
    },
  };
  const manager = new RoomManager(roomIO, systemClock);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: manager.listRooms().length });
  });

  // 生产模式:托管 web 构建产物(单端口即玩)
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!socket\.io|healthz).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;

    const playerId = (): string => {
      if (!data.playerId) throw new GameError('请先进入游戏');
      return data.playerId;
    };

    /** 包一层:业务错误回 ack,其余错误打日志。ack 位可能被恶意客户端塞非函数,必须显式校验 */
    const guard = <T>(ack: Ack<T> | undefined, fn: () => ({ ok: true } & T) | void): void => {
      const reply = typeof ack === 'function' ? ack : undefined;
      try {
        const res = fn();
        reply?.(res ?? ({ ok: true } as { ok: true } & T));
      } catch (e) {
        if (e instanceof GameError) {
          reply?.({ ok: false, error: e.message });
        } else {
          console.error('[draw-guess] handler error', e);
          reply?.({ ok: false, error: '服务器开小差了' });
        }
      }
    };

    socket.on('hello', (p, ack) => {
      guard(ack, () => {
        const id = String(p?.playerId ?? '').trim();
        const name = String(p?.name ?? '').trim().slice(0, NAME_MAX_LEN);
        if (id.length < 8 || id.length > 64) throw new GameError('无效的玩家标识');
        if (!name) throw new GameError('昵称不能为空');
        // 同一 playerId 重复连接:踢掉旧连接
        const old = sockets.get(id);
        if (old && old.id !== socket.id) old.disconnect(true);
        data.playerId = id;
        data.name = name;
        sockets.set(id, socket);
        const inRoom = manager.hello(id);
        return { ok: true, inRoom };
      });
    });

    socket.on('room:create', (p, ack) => {
      guard(ack, () => {
        const roomId = manager.createRoom(playerId(), data.name ?? '玩家', p?.config ?? {});
        return { ok: true, roomId };
      });
    });

    socket.on('room:join', (p, ack) => {
      guard(ack, () => {
        manager.joinRoom(playerId(), data.name ?? '玩家', String(p?.roomId ?? ''));
      });
    });

    socket.on('room:leave', (ack) => {
      guard(ack, () => {
        manager.leaveRoom(playerId());
      });
    });

    socket.on('room:list', (ack) => {
      guard(ack, () => ({ ok: true as const, rooms: manager.listRooms() }));
    });

    socket.on('room:ready', (p, ack) => {
      guard(ack, () => {
        const id = playerId();
        manager.getRoomOf(id)?.setReady(id, !!p?.ready);
      });
    });

    socket.on('game:start', (ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.startGame(id);
      });
    });

    socket.on('game:chooseWord', (p, ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.chooseWord(id, Number(p?.index), typeof p?.text === 'string' ? p.text : undefined);
      });
    });

    socket.on('game:refreshWords', (ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.refreshWords(id);
      });
    });

    socket.on('game:again', (ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.playAgain(id);
      });
    });

    socket.on('chat:send', (p, ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.chat(id, String(p?.text ?? ''));
      });
    });

    socket.on('relay:done', (ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.relayDone(id);
      });
    });

    socket.on('relay:guess', (p, ack) => {
      guard(ack, () => {
        const id = playerId();
        const room = manager.getRoomOf(id);
        if (!room) throw new GameError('不在房间中');
        room.relayGuess(id, String(p?.word ?? ''));
      });
    });

    socket.on('draw:stroke', (s) => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.addStroke(id, s);
    });

    socket.on('draw:point', (p) => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.addPoints(id, String(p?.strokeId ?? ''), p?.points ?? []);
    });

    socket.on('draw:clear', () => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.clearCanvas(id);
    });

    socket.on('voice:join', () => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.voiceJoin(id);
    });

    socket.on('voice:leave', () => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.voiceLeave(id);
    });

    socket.on('voice:mute', (p) => {
      const id = data.playerId;
      if (!id) return;
      manager.getRoomOf(id)?.voiceMute(id, !!p?.muted);
    });

    socket.on('voice:signal', (p) => {
      const id = data.playerId;
      if (!id || !p?.to) return;
      const room = manager.getRoomOf(id);
      // 仅允许同房间内信令转发
      if (!room || !room.hasPlayer(String(p.to))) return;
      roomIO.send(String(p.to), 'voice:signal', { from: id, data: p.data });
    });

    socket.on('disconnect', () => {
      const id = data.playerId;
      if (!id) return;
      // 仅当此 socket 仍是该玩家的当前连接时才算掉线(避免顶号误判)
      if (sockets.get(id)?.id === socket.id) {
        sockets.delete(id);
        manager.onDisconnect(id);
      }
    });
  });

  return { httpServer, io, manager };
}
