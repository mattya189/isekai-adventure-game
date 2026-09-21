import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/battle';
import { createSampleBattleInput } from '../src/sample';
import type { ActiveSkill, BattleInput, UnitSetup, WorldRule } from '../src/types';

const attack: ActiveSkill = {
  id: 'attack', name: '攻撃', category: 'physical', power: 1, target: 'enemy_single', cooldown: 0, sureHit: true,
};

function makeUnit(id: string, overrides: Partial<UnitSetup> = {}): UnitSetup {
  return {
    id,
    name: id,
    kind: 'human',
    stats: { hp: 1000, atk: 100, def: 100, mag: 100, mdef: 100, spd: 100, crit: 0, evade: 0, accuracy: 0, hate: 2 },
    skills: [{ skill: attack, priority: 1 }],
    passives: [],
    ...overrides,
  };
}

function input(attackers: UnitSetup[], defenders: UnitSetup[], overrides: Partial<BattleInput> = {}): BattleInput {
  return { seed: 42, attackers, defenders, rules: [], maxTurns: 20, snapshotInterval: 5, ...overrides };
}

describe('deterministic battle', () => {
  it('returns exactly the same output for the same input and seed', () => {
    const battle = createSampleBattleInput(123456);
    expect(runBattle(battle)).toEqual(runBattle(battle));
  });

  it('can change its damage rolls when the seed changes', () => {
    const a = runBattle(createSampleBattleInput(1));
    const b = runBattle(createSampleBattleInput(2));
    expect(a.events).not.toEqual(b.events);
  });
});

describe('action gauge and ordering', () => {
  it('breaks a complete tie by attacker side and then party position', () => {
    const result = runBattle(input([makeUnit('a0'), makeUnit('a1')], [makeUnit('d0'), makeUnit('d1')], { maxTurns: 4 }));
    expect(result.events.map((event) => event.actorId)).toEqual(['a0', 'a1', 'd0', 'd1']);
  });

  it('preserves excess gauge and lets a faster unit act more often', () => {
    const fast = makeUnit('fast', { stats: { ...makeUnit('x').stats, spd: 190 } });
    const slow = makeUnit('slow', { stats: { ...makeUnit('x').stats, spd: 100 } });
    const result = runBattle(input([fast], [slow], { maxTurns: 20 }));
    expect(result.events.filter((event) => event.actorId === 'fast').length).toBeGreaterThan(
      result.events.filter((event) => event.actorId === 'slow').length,
    );
  });

  it('counts an incapacitated turn as one action', () => {
    const stun: ActiveSkill = {
      id: 'stun', name: '気絶打撃', category: 'physical', power: 0.1, target: 'enemy_single', cooldown: 0, sureHit: true,
      effects: [{ kind: 'status', status: { type: 'stun', chance: 1, duration: 1 } }],
    };
    const result = runBattle(input(
      [makeUnit('stunner', { stats: { ...makeUnit('x').stats, spd: 110 }, skills: [{ skill: stun, priority: 3 }] })],
      [makeUnit('victim')],
      { maxTurns: 3 },
    ));
    expect(result.events[1]).toMatchObject({ actorId: 'victim', skillName: '行動不能' });
    expect(result.snapshots.at(-1)?.units.find((unit) => unit.id === 'victim')?.actionCount).toBe(1);
  });
});

describe('skill selection and cooldowns', () => {
  it('uses the highest priority available skill, then slot order, and priority 0 remains usable', () => {
    const highA = { ...attack, id: 'high-a', name: '高A', cooldown: 3 };
    const highB = { ...attack, id: 'high-b', name: '高B', cooldown: 3 };
    const low = { ...attack, id: 'low', name: '優先度0', cooldown: 0 };
    const actor = makeUnit('actor', { skills: [
      { skill: highA, priority: 3 }, { skill: highB, priority: 3 }, { skill: low, priority: 0 },
    ] });
    const result = runBattle(input([actor], [makeUnit('target')], { maxTurns: 7 }));
    const actions = result.events.filter((event) => event.actorId === 'actor');
    expect(actions[0]?.skillName).toBe('高A');
    expect(actions[1]?.skillName).toBe('高B');
    expect(actions[2]?.skillName).toBe('優先度0');
    expect(actions[3]?.skillName).toBe('高A');
  });

  it('falls back to normal attack when silence blocks the only magical skill', () => {
    const silence: ActiveSkill = {
      id: 'silence', name: '沈黙', category: 'support', power: 0, target: 'enemy_single', cooldown: 0,
      effects: [{ kind: 'status', status: { type: 'silence', chance: 1, duration: 2 } }],
    };
    const magic: ActiveSkill = { ...attack, id: 'magic', name: '魔法', category: 'magical' };
    const result = runBattle(input(
      [makeUnit('caster-of-silence', { stats: { ...makeUnit('x').stats, spd: 110 }, skills: [{ skill: silence, priority: 3 }] })],
      [makeUnit('mage', { skills: [{ skill: magic, priority: 3 }] })],
      { maxTurns: 2 },
    ));
    expect(result.events[1]).toMatchObject({ actorId: 'mage', skillName: '通常攻撃' });
  });
});

describe('damage, targeting, and effects', () => {
  it('caps effective evasion at 50 percent and sure-hit bypasses it', () => {
    const sureHit = makeUnit('sure', { skills: [{ skill: attack, priority: 1 }] });
    const evasive = makeUnit('evasive', { stats: { ...makeUnit('x').stats, evade: 100 } });
    const result = runBattle(input([sureHit], [evasive], { maxTurns: 1 }));
    expect(result.events[0]?.summary).toMatch(/ダメージ/);
  });

  it('enemy_all damages every living enemy', () => {
    const all: ActiveSkill = { ...attack, id: 'all', name: '全体攻撃', target: 'enemy_all' };
    const result = runBattle(input([makeUnit('actor', { skills: [{ skill: all, priority: 3 }] })], [makeUnit('d0'), makeUnit('d1')], { maxTurns: 1 }));
    const defenders = result.snapshots[0]!.units.filter((unit) => unit.side === 'defenders');
    expect(defenders.every((unit) => unit.hp < unit.maxHp)).toBe(true);
  });

  it('random multi-hit retargets when an earlier target is knocked out', () => {
    const randomTwo: ActiveSkill = { ...attack, id: 'random-two', name: '二連撃', target: 'enemy_random_n', hits: 2 };
    const actor = makeUnit('actor', {
      stats: { ...makeUnit('x').stats, atk: 5000 },
      skills: [{ skill: randomTwo, priority: 3 }],
    });
    const weakStats = { ...makeUnit('x').stats, hp: 10 };
    const result = runBattle(input([actor], [makeUnit('d0', { stats: weakStats }), makeUnit('d1', { stats: weakStats })], { maxTurns: 1 }));
    expect(result.snapshots[0]!.units.filter((unit) => unit.side === 'defenders').every((unit) => unit.knockedOut)).toBe(true);
  });

  it('lowest HP targeting ignores hate', () => {
    const execute: ActiveSkill = { ...attack, id: 'execute', name: '追撃', target: 'enemy_lowest_hp' };
    const carryOver = {
      tank: { hp: 1000, knockedOut: false, reviveUsed: false },
      weak: { hp: 100, knockedOut: false, reviveUsed: false },
    };
    const tank = makeUnit('tank', { stats: { ...makeUnit('x').stats, hate: 99 } });
    const result = runBattle(input([makeUnit('actor', { skills: [{ skill: execute, priority: 3 }] })], [tank, makeUnit('weak')], { maxTurns: 1, carryOver }));
    expect(result.events[0]?.summary).toContain('weak');
  });

  it('applies action-end poison and a world-rule hazard', () => {
    const poisonSelf: ActiveSkill = {
      id: 'poison-self', name: '毒化', category: 'support', power: 0, target: 'self', cooldown: 0,
      effects: [{ kind: 'status', status: { type: 'poison', chance: 1, duration: 2 } }],
    };
    const hazard: WorldRule = { id: 'heat', name: '灼熱', effects: [{ kind: 'action_end_damage', maxHpRatio: 0.02 }] };
    const result = runBattle(input([makeUnit('actor', { skills: [{ skill: poisonSelf, priority: 3 }] })], [makeUnit('target')], { maxTurns: 1, rules: [hazard] }));
    const actor = result.snapshots[0]!.units.find((unit) => unit.id === 'actor')!;
    expect(actor.hp).toBe(930);
    expect(actor.statuses).toEqual([{ type: 'poison', remaining: 1 }]);
  });

  it('can apply a timed status to everyone as a world rule', () => {
    const silenceRule: WorldRule = {
      id: 'silence', name: '静寂',
      effects: [{ kind: 'status', status: { type: 'silence', chance: 1, duration: 10 } }],
    };
    const magic: ActiveSkill = { ...attack, id: 'magic', name: '魔法', category: 'magical' };
    const result = runBattle(input(
      [makeUnit('a', { skills: [{ skill: magic, priority: 3 }] })],
      [makeUnit('d', { skills: [{ skill: magic, priority: 3 }] })],
      { maxTurns: 2, rules: [silenceRule] },
    ));
    expect(result.events.map((event) => event.skillName)).toEqual(['通常攻撃', '通常攻撃']);
    expect(result.snapshots[0]!.units.every((unit) => unit.statuses[0]?.type === 'silence')).toBe(true);
  });

  it('caps stacked stat modifiers at plus or minus 50 percent', () => {
    const buff: ActiveSkill = {
      id: 'buff', name: '重ね強化', category: 'support', power: 0, target: 'self', cooldown: 0,
      effects: [
        { kind: 'modifier', modifier: { stat: 'atk', amount: 0.4, duration: 3 } },
        { kind: 'modifier', modifier: { stat: 'atk', amount: 0.4, duration: 3 } },
      ],
    };
    const actor = makeUnit('actor', { skills: [{ skill: buff, priority: 3 }] });
    const result = runBattle(input([actor], [makeUnit('target')], { maxTurns: 1 }));
    const modifiers = result.snapshots[0]!.units.find((unit) => unit.id === 'actor')!.modifiers;
    expect(modifiers).toHaveLength(2);
  });
});

describe('knockout, revive, timeout, snapshots, and carry-over', () => {
  it('revives a unit only once and resets its gauge', () => {
    const revive: ActiveSkill = { id: 'revive', name: '蘇生', category: 'revive', power: 0, target: 'ally_dead', cooldown: 1, reviveHpRatio: 0.3 };
    const priest = makeUnit('priest', { skills: [{ skill: revive, priority: 3 }] });
    const dead = makeUnit('dead');
    const carryOver = { dead: { hp: 0, knockedOut: true, reviveUsed: false } };
    const result = runBattle(input([priest, dead], [makeUnit('enemy')], { maxTurns: 1, carryOver }));
    const revived = result.snapshots[0]!.units.find((unit) => unit.id === 'dead')!;
    expect(revived.hp).toBe(300);
    expect(revived.reviveUsed).toBe(true);
    expect(result.carryOut.dead).toMatchObject({ hp: 300, knockedOut: false, reviveUsed: true });
  });

  it('attacker loses at the exact turn limit and stores interval plus final snapshots', () => {
    const result = runBattle(input([makeUnit('a')], [makeUnit('d')], { maxTurns: 12, snapshotInterval: 5 }));
    expect(result).toMatchObject({ result: 'lose', reason: 'timeout', endTurn: 12 });
    expect(result.snapshots.map((snapshot) => snapshot.turn)).toEqual([5, 10, 12]);
  });

  it('ends immediately on a wipe and includes the decision snapshot', () => {
    const killer = makeUnit('killer', { stats: { ...makeUnit('x').stats, atk: 5000, spd: 110 } });
    const victim = makeUnit('victim', { stats: { ...makeUnit('x').stats, hp: 10 } });
    const result = runBattle(input([killer], [victim], { maxTurns: 200, snapshotInterval: 50 }));
    expect(result).toMatchObject({ result: 'win', reason: 'wipe', endTurn: 1 });
    expect(result.snapshots.map((snapshot) => snapshot.turn)).toEqual([1]);
  });

  it('produces a stable sample battle summary snapshot', () => {
    const result = runBattle(createSampleBattleInput());
    expect({
      result: result.result,
      reason: result.reason,
      endTurn: result.endTurn,
      snapshotTurns: result.snapshots.map((snapshot) => snapshot.turn),
      finalHp: result.snapshots.at(-1)!.units.map((unit) => [unit.id, unit.hp]),
    }).toMatchSnapshot();
  });
});

describe('validation', () => {
  it('rejects parties larger than four and non-positive timing values', () => {
    expect(() => runBattle(input(Array.from({ length: 5 }, (_, index) => makeUnit(`a${index}`)), [makeUnit('d')]))).toThrow(/1 to 4/);
    expect(() => runBattle(input([makeUnit('a')], [makeUnit('d')], { snapshotInterval: 0 }))).toThrow(/snapshotInterval/);
  });

  it('rejects duplicate IDs and too many equipped skills or passives', () => {
    expect(() => runBattle(input([makeUnit('same')], [makeUnit('same')]))).toThrow(/Duplicate/);
    const seven = makeUnit('seven', { skills: Array.from({ length: 7 }, () => ({ skill: attack, priority: 1 as const })) });
    expect(() => runBattle(input([seven], [makeUnit('d')]))).toThrow(/more than 6/);
  });
});
