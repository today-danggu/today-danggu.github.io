/**
 * 온라인 같이하기 방 상태 (순수 함수만. 저장·연결은 room.ts가 맡는다).
 *
 * 물리 계산은 서버가 하지 않는다. 치는 사람의 브라우저가 샷을 계산하고, 결과(공 위치·점수·차례)를 서버에 보낸다.
 * 상대 브라우저는 같은 샷을 재생한 뒤 그 결과로 위치를 맞춘다. (기기마다 소수점 계산이 조금씩 달라서 어긋나는 걸 막는다)
 */

export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const NAME_MAX = 8;
export const TARGETS = [5, 10, 20] as const;

export type GameKind = '4' | '3';
export type BallKind = 'white' | 'yellow' | 'red';
export type Phase = 'waiting' | 'playing' | 'finished';

/** 당구대 크기 (게임 화면과 같은 단위). */
export const TABLE_W = 1000;
export const TABLE_H = 500;

export interface Ball {
  id: string;
  kind: BallKind;
  x: number;
  y: number;
}

export interface PlayerStat {
  score: number;
  run: number;
  high: number;
  shots: number;
}

export interface Seat {
  /** 다시 들어올 때 쓰는 비밀 값. 상대에게는 보내지 않는다. */
  id: string;
  name: string;
}

export interface Shot {
  seq: number;
  by: number;
  ang: number;
  power: number;
  hx: number;
  hy: number;
}

export interface Toast {
  msg: string;
  sub: string;
  tone: string;
}

export interface RoomState {
  code: string;
  game: GameKind;
  target: number;
  seats: [Seat | null, Seat | null];
  phase: Phase;
  /** 판 번호. 다시 하기마다 1씩 는다. */
  round: number;
  /** 이번 판에 먼저 치는 자리. 다시 하기마다 바뀐다. */
  starter: number;
  cur: number;
  /** null이면 처음 배치. */
  balls: Ball[] | null;
  stats: [PlayerStat, PlayerStat];
  /** 마지막으로 끝난 샷 번호. */
  seq: number;
  /** 쳤지만 아직 결과가 오지 않은 샷. */
  pending: Shot | null;
  lastToast: Toast | null;
  winner: number | null;
  rematch: [boolean, boolean];
  createdAt: number;
  updatedAt: number;
}

export class RoomError extends Error {}

const BALLS: Record<GameKind, { id: string; kind: BallKind }[]> = {
  '4': [
    { id: 'W', kind: 'white' },
    { id: 'Y', kind: 'yellow' },
    { id: 'R1', kind: 'red' },
    { id: 'R2', kind: 'red' },
  ],
  '3': [
    { id: 'W', kind: 'white' },
    { id: 'Y', kind: 'yellow' },
    { id: 'R1', kind: 'red' },
  ],
};

const emptyStat = (): PlayerStat => ({ score: 0, run: 0, high: 0, shots: 0 });

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of value) if (!ROOM_CODE_CHARS.includes(ch)) return false;
  return true;
}

export function randomRoomCode(): string {
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ROOM_CODE_CHARS[n % ROOM_CODE_CHARS.length]).join('');
}

export function isGameKind(v: unknown): v is GameKind {
  return v === '4' || v === '3';
}

export function isTarget(v: unknown): v is number {
  return typeof v === 'number' && (TARGETS as readonly number[]).includes(v);
}

/** 닉네임: 앞뒤 공백을 빼고 1~8글자. 제어 문자는 안 된다. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new RoomError('닉네임을 입력해 주세요');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new RoomError('닉네임을 입력해 주세요');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new RoomError('닉네임에 쓸 수 없는 글자가 있어요');
  return [...name].slice(0, NAME_MAX).join('');
}

export function createRoom(code: string, game: GameKind, target: number, now: number): RoomState {
  return {
    code,
    game,
    target,
    seats: [null, null],
    phase: 'waiting',
    round: 0,
    starter: 0,
    cur: 0,
    balls: null,
    stats: [emptyStat(), emptyStat()],
    seq: 0,
    pending: null,
    lastToast: null,
    winner: null,
    rematch: [false, false],
    createdAt: now,
    updatedAt: now,
  };
}

function startGame(state: RoomState, now: number): void {
  state.phase = 'playing';
  state.round += 1;
  state.cur = state.starter;
  state.balls = null;
  state.stats = [emptyStat(), emptyStat()];
  state.seq = 0;
  state.pending = null;
  state.lastToast = null;
  state.winner = null;
  state.rematch = [false, false];
  state.updatedAt = now;
}

export function seatOf(state: RoomState, playerId: string | null | undefined): number {
  if (!playerId) return -1;
  return state.seats.findIndex((s) => s?.id === playerId);
}

/**
 * 들어오기. 이미 앉은 사람(playerId가 맞음)이면 그 자리로 돌아온다.
 * 빈자리에 앉아 두 자리가 다 차면 바로 게임을 시작한다.
 */
export function join(
  state: RoomState,
  playerId: string | null,
  name: unknown,
  newId: string,
  now: number,
): { seat: number; playerId: string } {
  const back = seatOf(state, playerId);
  if (back >= 0) {
    state.updatedAt = now;
    return { seat: back, playerId: playerId as string };
  }
  const open = state.seats.findIndex((s) => s === null);
  if (open < 0) throw new RoomError('이미 두 명이 들어와 있는 방이에요');
  state.seats[open] = { id: newId, name: cleanName(name) };
  if (state.seats.every(Boolean) && state.phase === 'waiting') startGame(state, now);
  state.updatedAt = now;
  return { seat: open, playerId: newId };
}

/** 나가기. 게임 중이었다면 판을 접고 새 상대를 기다린다. */
export function leave(state: RoomState, seat: number, now: number): void {
  if (seat < 0) return;
  state.seats[seat] = null;
  if (state.phase !== 'waiting') {
    state.phase = 'waiting';
    state.pending = null;
    state.balls = null;
    state.lastToast = null;
    state.winner = null;
    state.rematch = [false, false];
  }
  state.updatedAt = now;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function requireTurn(state: RoomState, seat: number): void {
  if (state.phase !== 'playing') throw new RoomError('지금은 칠 수 없어요');
  if (state.cur !== seat) throw new RoomError('상대 차례예요');
  if (state.pending) throw new RoomError('공이 아직 움직이고 있어요');
}

export function parseShot(msg: Record<string, unknown>): Omit<Shot, 'seq' | 'by'> {
  const { ang, power, hx, hy } = msg;
  if (!finite(ang) || !finite(power) || !finite(hx) || !finite(hy)) throw new RoomError('샷 정보가 올바르지 않아요');
  if (power < 3 || power > 100) throw new RoomError('힘이 올바르지 않아요');
  if (Math.abs(hx) > 1 || Math.abs(hy) > 1 || Math.hypot(hx, hy) > 1.01) throw new RoomError('당점이 올바르지 않아요');
  return { ang, power, hx, hy };
}

/** 치기. 결과가 올 때까지 다음 샷은 받지 않는다. */
export function shoot(state: RoomState, seat: number, msg: Record<string, unknown>, now: number): Shot {
  requireTurn(state, seat);
  const shot: Shot = { seq: state.seq + 1, by: seat, ...parseShot(msg) };
  state.pending = shot;
  state.stats[seat].shots += 1;
  state.updatedAt = now;
  return shot;
}

/** 조준 중계 (저장하지 않는다). 내 차례일 때만. */
export function parseAim(state: RoomState, seat: number, msg: Record<string, unknown>): Record<string, unknown> {
  requireTurn(state, seat);
  const { ang, power, hx, hy, pulling } = msg;
  if (!finite(ang) || !finite(power) || !finite(hx) || !finite(hy)) throw new RoomError('조준 정보가 올바르지 않아요');
  return {
    type: 'aim',
    ang,
    power: Math.max(0, Math.min(100, power)),
    hx: Math.max(-1, Math.min(1, hx)),
    hy: Math.max(-1, Math.min(1, hy)),
    pulling: pulling === true,
  };
}

function parseBalls(state: RoomState, value: unknown): Ball[] {
  const want = BALLS[state.game];
  if (!Array.isArray(value) || value.length !== want.length) throw new RoomError('공 정보가 올바르지 않아요');
  return want.map((w) => {
    const b = value.find((v) => v && typeof v === 'object' && (v as Ball).id === w.id) as Ball | undefined;
    if (!b || !finite(b.x) || !finite(b.y)) throw new RoomError('공 정보가 올바르지 않아요');
    if (b.x < -1 || b.x > TABLE_W + 1 || b.y < -1 || b.y > TABLE_H + 1) throw new RoomError('공이 당구대 밖에 있어요');
    return { id: w.id, kind: w.kind, x: b.x, y: b.y };
  });
}

function parseStat(value: unknown): PlayerStat {
  const v = value as Partial<PlayerStat> | null;
  const int = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10000 ? (n as number) : null);
  const s = { score: int(v?.score), run: int(v?.run), high: int(v?.high), shots: int(v?.shots) };
  if (s.score === null || s.run === null || s.high === null || s.shots === null) throw new RoomError('점수 정보가 올바르지 않아요');
  return s as PlayerStat;
}

function shortText(v: unknown, max: number): string {
  return typeof v === 'string' ? [...v].slice(0, max).join('') : '';
}

/**
 * 샷 결과. 친 사람만, 방금 친 샷 번호로 보낼 수 있다.
 * 점수 계산은 친 사람 화면이 하고, 서버는 형식과 범위만 확인한다. (친구끼리 하는 게임이라 이 정도로 둔다)
 */
export function applyResult(state: RoomState, seat: number, msg: Record<string, unknown>, now: number): void {
  const p = state.pending;
  if (!p || p.by !== seat || msg.seq !== p.seq) throw new RoomError('이미 처리된 샷이에요');
  const balls = parseBalls(state, msg.balls);
  if (!Array.isArray(msg.stats) || msg.stats.length !== 2) throw new RoomError('점수 정보가 올바르지 않아요');
  const stats: [PlayerStat, PlayerStat] = [parseStat(msg.stats[0]), parseStat(msg.stats[1])];
  // 상대 점수와 샷 수는 바꿀 수 없다.
  const other = 1 - seat;
  if (stats[other].score !== state.stats[other].score || stats[other].shots !== state.stats[other].shots) {
    throw new RoomError('상대 점수는 바꿀 수 없어요');
  }
  stats[seat].shots = state.stats[seat].shots;
  const before = state.stats[seat].score;
  if (Math.abs(stats[seat].score - before) > 1) throw new RoomError('한 번에 1점까지만 바뀌어요');
  const scored = stats[seat].score > before;
  const over = stats[seat].score >= state.target;

  state.balls = balls;
  state.stats = stats;
  state.seq = p.seq;
  state.pending = null;
  state.lastToast = { msg: shortText((msg.toast as Toast)?.msg, 20), sub: shortText((msg.toast as Toast)?.sub, 60), tone: shortText((msg.toast as Toast)?.tone, 8) };
  if (over) {
    state.phase = 'finished';
    state.winner = seat;
  } else {
    // 득점하면 계속, 아니면 차례가 넘어간다.
    state.cur = scored ? seat : other;
  }
  state.updatedAt = now;
}

/** 다시 하기. 두 사람이 다 누르면 먼저 치는 사람을 바꿔서 새 판. */
export function requestRematch(state: RoomState, seat: number, now: number): boolean {
  if (state.phase !== 'finished') throw new RoomError('경기가 끝난 뒤에 누를 수 있어요');
  state.rematch[seat] = true;
  state.updatedAt = now;
  if (state.rematch[0] && state.rematch[1]) {
    state.starter = 1 - state.starter;
    startGame(state, now);
    return true;
  }
  return false;
}

/** 받는 사람에게 보낼 화면 상태. 다른 사람의 playerId는 넣지 않는다. */
export function viewFor(state: RoomState, seat: number, connected: [boolean, boolean]) {
  return {
    type: 'state',
    code: state.code,
    game: state.game,
    target: state.target,
    phase: state.phase,
    round: state.round,
    you: seat,
    seats: state.seats.map((s, i) => (s ? { name: s.name, connected: connected[i] } : null)),
    cur: state.cur,
    balls: state.balls,
    stats: state.stats,
    seq: state.seq,
    pending: state.pending,
    lastToast: state.lastToast,
    winner: state.winner,
    rematch: state.rematch,
  };
}
