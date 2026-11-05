import { describe, expect, it } from 'vitest';
import {
  RoomError,
  applyResult,
  cleanName,
  createRoom,
  isRoomCode,
  join,
  leave,
  parseAim,
  randomRoomCode,
  requestRematch,
  shoot,
  viewFor,
  type RoomState,
} from '../src/match';

const T = 1_000_000;
const balls4 = [
  { id: 'W', kind: 'white', x: 200, y: 300 },
  { id: 'Y', kind: 'yellow', x: 180, y: 170 },
  { id: 'R1', kind: 'red', x: 290, y: 250 },
  { id: 'R2', kind: 'red', x: 750, y: 250 },
];
const stat = (score = 0, shots = 0) => ({ score, run: score, high: score, shots });

function full(target = 10): { s: RoomState; a: string; b: string } {
  const s = createRoom('ABCD', '4', target, T);
  const a = join(s, null, '상원', 'id-a', T).playerId;
  const b = join(s, null, '친구', 'id-b', T).playerId;
  return { s, a, b };
}
const shot = { ang: 0.3, power: 50, hx: 0, hy: 0.2 };

describe('방 코드', () => {
  it('만든 코드는 형식에 맞는다', () => {
    for (let i = 0; i < 50; i++) expect(isRoomCode(randomRoomCode())).toBe(true);
    expect(isRoomCode('AB1D')).toBe(false); // 1은 헷갈려서 안 씀
    expect(isRoomCode('ABCDE')).toBe(false);
  });
});

describe('입장', () => {
  it('두 명이 들어오면 바로 시작한다', () => {
    const s = createRoom('ABCD', '3', 5, T);
    expect(join(s, null, 'a', 'x', T).seat).toBe(0);
    expect(s.phase).toBe('waiting');
    expect(join(s, null, 'b', 'y', T).seat).toBe(1);
    expect(s.phase).toBe('playing');
    expect(s.cur).toBe(0);
    expect(() => join(s, null, 'c', 'z', T)).toThrow(RoomError);
  });
  it('playerId로 같은 자리에 돌아온다', () => {
    const { s, b } = full();
    expect(join(s, b, '', 'new', T)).toEqual({ seat: 1, playerId: b });
  });
  it('닉네임은 8글자까지', () => {
    expect(cleanName('  가나다라마바사아자차 ')).toBe('가나다라마바사아');
    expect(() => cleanName('   ')).toThrow(RoomError);
  });
  it('상대 이름은 보이지만 playerId는 보내지 않는다', () => {
    const { s } = full();
    const v = JSON.stringify(viewFor(s, 0, [true, false]));
    expect(v).toContain('친구');
    expect(v).not.toContain('id-b');
  });
});

describe('샷과 결과', () => {
  it('내 차례에만 칠 수 있고, 결과 전에는 다시 못 친다', () => {
    const { s } = full();
    expect(() => shoot(s, 1, shot, T)).toThrow('상대 차례');
    const sh = shoot(s, 0, shot, T);
    expect(sh).toMatchObject({ seq: 1, by: 0, power: 50 });
    expect(() => shoot(s, 0, shot, T)).toThrow(RoomError);
    expect(() => parseAim(s, 0, shot)).toThrow(RoomError);
  });
  it('이상한 힘·당점은 막는다', () => {
    const { s } = full();
    expect(() => shoot(s, 0, { ...shot, power: 500 }, T)).toThrow(RoomError);
    expect(() => shoot(s, 0, { ...shot, hx: 1, hy: 1 }, T)).toThrow(RoomError);
    expect(() => shoot(s, 0, { ...shot, ang: 'x' }, T)).toThrow(RoomError);
  });
  it('실패하면 차례가 넘어가고, 득점하면 계속 친다', () => {
    const { s } = full();
    shoot(s, 0, shot, T);
    applyResult(s, 0, { seq: 1, balls: balls4, stats: [stat(0, 1), stat()], toast: { msg: '실패', sub: '', tone: 'bad' } }, T);
    expect(s.cur).toBe(1);
    expect(s.balls?.[0]).toEqual({ id: 'W', kind: 'white', x: 200, y: 300 });
    shoot(s, 1, shot, T);
    applyResult(s, 1, { seq: 2, balls: balls4, stats: [stat(0, 1), stat(1, 1)] }, T);
    expect(s.cur).toBe(1);
    expect(s.stats[1].score).toBe(1);
  });
  it('친 사람만, 그 샷 번호로만 결과를 보낼 수 있다', () => {
    const { s } = full();
    shoot(s, 0, shot, T);
    expect(() => applyResult(s, 1, { seq: 1, balls: balls4, stats: [stat(), stat()] }, T)).toThrow(RoomError);
    expect(() => applyResult(s, 0, { seq: 2, balls: balls4, stats: [stat(), stat()] }, T)).toThrow(RoomError);
  });
  it('상대 점수를 바꾸거나 2점 이상 올리면 막는다', () => {
    const { s } = full();
    shoot(s, 0, shot, T);
    expect(() => applyResult(s, 0, { seq: 1, balls: balls4, stats: [stat(), stat(3)] }, T)).toThrow('상대 점수');
    expect(() => applyResult(s, 0, { seq: 1, balls: balls4, stats: [stat(2), stat()] }, T)).toThrow(RoomError);
  });
  it('공 개수와 위치를 확인한다', () => {
    const { s } = full();
    shoot(s, 0, shot, T);
    expect(() => applyResult(s, 0, { seq: 1, balls: balls4.slice(0, 3), stats: [stat(), stat()] }, T)).toThrow(RoomError);
    expect(() => applyResult(s, 0, { seq: 1, balls: [{ ...balls4[0], x: 5000 }, ...balls4.slice(1)], stats: [stat(), stat()] }, T)).toThrow(RoomError);
  });
  it('목표 점수에 닿으면 끝나고, 둘 다 다시 하기를 누르면 먼저 치는 사람을 바꿔 새 판', () => {
    const { s } = full(5);
    s.stats[0].score = 4;
    shoot(s, 0, shot, T);
    applyResult(s, 0, { seq: 1, balls: balls4, stats: [stat(5, 1), stat()] }, T);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe(0);
    expect(() => shoot(s, 0, shot, T)).toThrow(RoomError);
    expect(requestRematch(s, 0, T)).toBe(false);
    expect(requestRematch(s, 1, T)).toBe(true);
    expect(s.phase).toBe('playing');
    expect(s.cur).toBe(1);
    expect(s.round).toBe(2);
    expect(s.stats[0].score).toBe(0);
    expect(s.balls).toBeNull();
  });
});

describe('나가기', () => {
  it('게임 중에 나가면 판을 접고 빈자리를 연다', () => {
    const { s } = full();
    leave(s, 1, T);
    expect(s.phase).toBe('waiting');
    expect(s.seats[1]).toBeNull();
    join(s, null, '새친구', 'id-c', T);
    expect(s.phase).toBe('playing');
  });
});

describe('포켓볼', () => {
  const poolBalls = (sunk: number[] = []) => [
    { id: 'C', kind: 'white', x: 250, y: 250 },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `B${i + 1}`, kind: 'pool', x: 700 + i, y: 250, in: sunk.includes(i + 1) })),
  ];
  const extra = (groups: [string | null, string | null] = [null, null], bih = false) => ({ groups, bih, broke: true, kitchen: false });
  function poolRoom() {
    const s = createRoom('PQRS', '8', 10, T);
    join(s, null, 'a', 'id-a', T);
    join(s, null, 'b', 'id-b', T);
    return s;
  }
  it('공 16개와 들어간 공을 기억하고, 차례와 공 무리는 친 사람이 정한다', () => {
    const s = poolRoom();
    shoot(s, 0, { ...shot, cx: 200, cy: 260 }, T);
    expect(s.pending).toMatchObject({ cx: 200, cy: 260 });
    applyResult(s, 0, { seq: 1, balls: poolBalls([3]), stats: [stat(1, 1), stat()], cur: 0, winner: null, extra: extra(['solid', 'stripe']) }, T);
    expect(s.balls?.find((b) => b.id === 'B3')).toMatchObject({ in: true, n: 3 });
    expect(s.cur).toBe(0);
    expect(s.extra?.groups).toEqual(['solid', 'stripe']);
    const v = viewFor(s, 1, [true, true]);
    expect(v.extra?.groups[0]).toBe('solid');
  });
  it('상대 공을 넣어 상대 점수가 바뀌어도 받는다, 같은 무리 둘은 막는다', () => {
    const s = poolRoom();
    shoot(s, 0, shot, T);
    expect(() => applyResult(s, 0, { seq: 1, balls: poolBalls(), stats: [stat(), stat()], cur: 1, extra: extra(['solid', 'solid']) }, T)).toThrow(RoomError);
    applyResult(s, 0, { seq: 1, balls: poolBalls([10]), stats: [stat(0, 1), stat(1)], cur: 1, winner: null, extra: extra(['solid', 'stripe'], true) }, T);
    expect(s.stats[1].score).toBe(1);
    expect(s.cur).toBe(1);
    expect(s.extra?.bih).toBe(true);
  });
  it('승자가 오면 끝나고, 다시 하기면 포켓볼 상태도 처음으로', () => {
    const s = poolRoom();
    shoot(s, 0, shot, T);
    applyResult(s, 0, { seq: 1, balls: poolBalls([8]), stats: [stat(), stat()], cur: 0, winner: 1, extra: extra() }, T);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe(1);
    requestRematch(s, 0, T);
    requestRematch(s, 1, T);
    expect(s.extra).toBeNull();
    expect(s.balls).toBeNull();
  });
  it('흰 공 위치가 당구대 밖이면 막는다', () => {
    const s = poolRoom();
    expect(() => shoot(s, 0, { ...shot, cx: -50, cy: 10 }, T)).toThrow(RoomError);
  });
});
