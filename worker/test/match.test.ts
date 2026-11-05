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
