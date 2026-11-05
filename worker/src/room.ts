import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import {
  RoomError,
  type RoomState,
  applyResult,
  createRoom,
  isGameKind,
  isTarget,
  join,
  leave,
  parseAim,
  requestRematch,
  seatOf,
  shoot,
  viewFor,
} from './match';

/** 아무도 접속해 있지 않은 방은 이 시간 뒤 지운다. */
const IDLE_MS = 15 * 60 * 1000;
/** 접속해 있어도 이 시간 넘게 아무 샷이 없으면 지운다. */
const ABANDON_MS = 2 * 60 * 60 * 1000;
/** 메시지 하나의 최대 크기. */
const MAX_MESSAGE = 4096;

interface Attachment {
  seat: number;
  playerId: string;
}

/** 방 하나 = Durable Object 하나. 방 코드로 찾는다. */
export class DangguRoom extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  /** 상태 변경을 한 번에 하나씩 처리한다. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 접속 유지용 ping은 객체를 깨우지 않고 바로 응답한다.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private load(): Promise<RoomState | undefined> {
    return this.ctx.storage.get<RoomState>('state');
  }

  private async save(state: RoomState): Promise<void> {
    await this.ctx.storage.put('state', state);
    await this.ctx.storage.setAlarm(Math.max(state.updatedAt + IDLE_MS, Date.now() + 60_000));
  }

  private sockets(): { ws: WebSocket; att: Attachment }[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => ({ ws, att: ws.deserializeAttachment() as Attachment | null }))
      .filter((s): s is { ws: WebSocket; att: Attachment } => !!s.att);
  }

  private connected(except?: WebSocket): [boolean, boolean] {
    const live = this.sockets().filter((s) => s.ws !== except);
    return [live.some((s) => s.att.seat === 0), live.some((s) => s.att.seat === 1)];
  }

  private broadcast(state: RoomState, except?: WebSocket): void {
    const connected = this.connected(except);
    for (const { ws, att } of this.sockets()) {
      if (ws === except) continue;
      send(ws, viewFor(state, att.seat, connected));
    }
  }

  private sendOthers(from: WebSocket, seat: number, msg: unknown): void {
    for (const { ws, att } of this.sockets()) if (ws !== from && att.seat !== seat) send(ws, msg);
  }

  private static reject(message: string, code: number): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    send(server, { type: 'error', message, fatal: true });
    server.close(code, 'rejected');
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    return this.serial(() => this.handleFetch(request));
  }

  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init') {
      const game = url.searchParams.get('game');
      const target = Number(url.searchParams.get('target'));
      if (!isGameKind(game) || !isTarget(target)) return new Response('bad settings', { status: 400 });
      if (await this.load()) return new Response('exists', { status: 409 });
      await this.save(createRoom(url.searchParams.get('code') ?? '', game, target, Date.now()));
      return new Response('created', { status: 201 });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket 연결이 필요해요', { status: 426 });
      }
      const state = await this.load();
      if (!state) return DangguRoom.reject('없는 방이에요. 코드를 확인해 주세요', 4004);
      let seat: number;
      let playerId: string;
      try {
        ({ seat, playerId } = join(state, url.searchParams.get('playerId'), url.searchParams.get('name') ?? '', crypto.randomUUID(), Date.now()));
      } catch (err) {
        if (err instanceof RoomError) return DangguRoom.reject(err.message, 4009);
        throw err;
      }
      // 같은 자리의 예전 연결(다른 탭·끊긴 연결)은 닫는다.
      for (const s of this.sockets()) {
        if (s.att.seat === seat) {
          send(s.ws, { type: 'error', message: '다른 화면에서 이 자리로 들어왔어요', fatal: true });
          s.ws.close(4001, 'replaced');
        }
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ seat, playerId } satisfies Attachment);
      await this.save(state);
      send(server, { type: 'welcome', playerId, seat });
      this.broadcast(state);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    await this.serial(async () => {
      const att = ws.deserializeAttachment() as Attachment | null;
      const state = await this.load();
      if (!att || !state) return;
      // 자리가 바뀌었거나(나갔다 다른 사람이 앉음) 없어진 연결
      if (seatOf(state, att.playerId) !== att.seat) {
        send(ws, { type: 'error', message: '방에서 나간 상태예요', fatal: true });
        ws.close(4003, 'gone');
        return;
      }
      const now = Date.now();
      try {
        switch (msg.type) {
          case 'aim':
            // 저장하지 않고 상대에게만 바로 보낸다.
            this.sendOthers(ws, att.seat, parseAim(state, att.seat, msg));
            return;
          case 'shot': {
            const shot = shoot(state, att.seat, msg, now);
            await this.save(state);
            for (const s of this.sockets()) send(s.ws, { type: 'shot', ...shot });
            this.broadcast(state);
            return;
          }
          case 'result':
            applyResult(state, att.seat, msg, now);
            break;
          case 'rematch':
            requestRematch(state, att.seat, now);
            break;
          case 'leave':
            leave(state, att.seat, now);
            await this.save(state);
            ws.close(1000, 'left');
            this.broadcast(state, ws);
            return;
          default:
            return;
        }
        await this.save(state);
        this.broadcast(state);
      } catch (err) {
        if (err instanceof RoomError) send(ws, { type: 'error', message: err.message });
        else throw err;
      }
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // 끊긴 연결은 자리를 비우지 않는다 (다시 들어올 수 있게). 상대에게 끊김만 알린다.
    await this.serial(async () => {
      const state = await this.load();
      if (state) this.broadcast(state, ws);
    });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const now = Date.now();
    const anyone = this.sockets().length > 0;
    if ((!anyone && now - state.updatedAt >= IDLE_MS) || now - state.updatedAt >= ABANDON_MS) {
      for (const { ws } of this.sockets()) {
        send(ws, { type: 'error', message: '오래 쉬어서 방이 닫혔어요', fatal: true });
        ws.close(4010, 'expired');
      }
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(now + (anyone ? ABANDON_MS - (now - state.updatedAt) : IDLE_MS));
  }
}

function send(ws: WebSocket, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // 이미 닫힌 연결
  }
}
