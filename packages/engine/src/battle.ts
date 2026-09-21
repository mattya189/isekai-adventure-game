import { mulberry32, type RandomSource } from './rng';
import type {
  ActiveSkill,
  BattleEffect,
  BattleEvent,
  BattleInput,
  BattleOutput,
  DebugBattleEvent,
  DebugTargetEvent,
  BuffStatKey,
  CarryOver,
  ModifierSnapshot,
  PassiveEffect,
  RuleEffect,
  RevivalRecord,
  Side,
  Snapshot,
  StatKey,
  Stats,
  StatusSnapshot,
  StatusType,
  UnitSetup,
  UnitSnapshot,
} from './types';

interface TimedStatus {
  type: StatusType;
  remaining: number;
}

interface TimedModifier {
  stat: BuffStatKey | 'hate';
  amount: number;
  remaining: number;
}

interface RuntimeUnit {
  setup: UnitSetup;
  side: Side;
  position: number;
  baseStats: Stats;
  hp: number;
  gauge: number;
  cooldowns: number[];
  statuses: TimedStatus[];
  modifiers: TimedModifier[];
  passiveEffects: PassiveEffect[];
  actionCount: number;
  damageDealt: number;
  damageTaken: number;
  reviveUsed: boolean;
}

const NORMAL_ATTACK: ActiveSkill = {
  id: 'normal_attack',
  name: '通常攻撃',
  category: 'physical',
  power: 1,
  target: 'enemy_single',
  cooldown: 0,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isAlive = (unit: RuntimeUnit): boolean => unit.hp > 0;

function validateInput(input: BattleInput): void {
  if (input.attackers.length < 1 || input.attackers.length > 4 || input.defenders.length < 1 || input.defenders.length > 4) {
    throw new Error('Each party must contain 1 to 4 units.');
  }
  if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
    throw new Error('maxTurns must be a positive integer.');
  }
  if (!Number.isInteger(input.snapshotInterval) || input.snapshotInterval <= 0) {
    throw new Error('snapshotInterval must be a positive integer.');
  }
  const ids = new Set<string>();
  for (const unit of [...input.attackers, ...input.defenders]) {
    if (ids.has(unit.id)) throw new Error(`Duplicate unit id: ${unit.id}`);
    ids.add(unit.id);
    if (unit.skills.length > 6) throw new Error(`${unit.id} has more than 6 active skills.`);
    if (unit.passives.length > 2) throw new Error(`${unit.id} has more than 2 equipped passives.`);
    for (const [key, value] of Object.entries(unit.stats)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${unit.id}.${key} must be a non-negative number.`);
    }
    if (unit.stats.hp <= 0 || unit.stats.spd <= 0) throw new Error(`${unit.id} must have positive hp and spd.`);
  }
}

function statWithEffects(base: Stats, effects: PassiveEffect[]): Stats {
  const result = { ...base };
  for (const effect of effects) {
    if (effect.kind !== 'stat') continue;
    const key = effect.stat;
    result[key] *= 1 + effect.amount;
  }
  result.hp = Math.max(1, Math.floor(result.hp));
  for (const key of ['atk', 'def', 'mag', 'mdef', 'spd'] as const) result[key] = Math.max(1, result[key]);
  result.hate = Math.max(0, result.hate);
  return result;
}

function createRuntimeUnit(
  setup: UnitSetup,
  side: Side,
  position: number,
  globalEffects: PassiveEffect[],
  carryOver: CarryOver | undefined,
): RuntimeUnit {
  const passiveEffects = [...setup.passives.flatMap((passive) => passive.effects), ...globalEffects];
  const baseStats = statWithEffects(setup.stats, passiveEffects);
  const carry = carryOver?.[setup.id];
  const startHp = carry ? (carry.knockedOut ? 0 : clamp(Math.floor(carry.hp), 1, baseStats.hp)) : baseStats.hp;
  const gauge = passiveEffects
    .filter((effect): effect is Extract<PassiveEffect, { kind: 'initial_gauge' }> => effect.kind === 'initial_gauge')
    .reduce((sum, effect) => sum + effect.amount, 0);
  return {
    setup,
    side,
    position,
    baseStats,
    hp: startHp,
    gauge: Math.max(0, gauge),
    cooldowns: setup.skills.map(() => 0),
    statuses: [],
    modifiers: [],
    passiveEffects,
    actionCount: 0,
    damageDealt: 0,
    damageTaken: 0,
    reviveUsed: carry?.reviveUsed ?? false,
  };
}

function isPassiveEffect(effect: RuleEffect): effect is PassiveEffect {
  return ['stat', 'initial_gauge', 'status_resistance', 'action_end_damage', 'skill_power'].includes(effect.kind);
}

function getStat(unit: RuntimeUnit, stat: StatKey): number {
  let base = unit.baseStats[stat];
  if (stat === 'hate') {
    base += unit.modifiers.filter((modifier) => modifier.stat === 'hate').reduce((sum, modifier) => sum + modifier.amount, 0);
    return Math.max(0, base);
  }
  if (stat === 'hp') return base;
  const burnPenalty = stat === 'atk' && getStatus(unit, 'burn') ? -0.2 : 0;
  const modifier = clamp(
    unit.modifiers.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, burnPenalty),
    -0.5,
    0.5,
  );
  return Math.max(0, base * (1 + modifier));
}

function getStatus(unit: RuntimeUnit, type: StatusType): TimedStatus | undefined {
  return unit.statuses.find((status) => status.type === type);
}

function removeStatus(unit: RuntimeUnit, type: StatusType): void {
  unit.statuses = unit.statuses.filter((status) => status.type !== type);
}

function applyStatus(unit: RuntimeUnit, type: StatusType, duration: number): void {
  if (!isAlive(unit) || duration <= 0) return;
  const current = getStatus(unit, type);
  if (current) current.remaining = Math.max(current.remaining, duration);
  else unit.statuses.push({ type, remaining: duration });
}

function applyModifier(unit: RuntimeUnit, stat: BuffStatKey | 'hate', amount: number, duration: number): void {
  if (isAlive(unit) && duration > 0) unit.modifiers.push({ stat, amount, remaining: duration });
}

function statusResistance(unit: RuntimeUnit, status: StatusType): number {
  return clamp(
    unit.passiveEffects
      .filter(
        (effect): effect is Extract<PassiveEffect, { kind: 'status_resistance' }> =>
          effect.kind === 'status_resistance' && (!effect.status || effect.status === status),
      )
      .reduce((sum, effect) => sum + effect.amount, 0),
    0,
    1,
  );
}

function opposite(side: Side): Side {
  return side === 'attackers' ? 'defenders' : 'attackers';
}

function weightedTarget(units: RuntimeUnit[], rng: RandomSource): RuntimeUnit | undefined {
  if (units.length === 0) return undefined;
  const total = units.reduce((sum, unit) => sum + getStat(unit, 'hate'), 0);
  if (total <= 0) return units[rng.integer(units.length)];
  let roll = rng.next() * total;
  for (const unit of units) {
    roll -= getStat(unit, 'hate');
    if (roll < 0) return unit;
  }
  return units.at(-1);
}

function lowestHp(units: RuntimeUnit[]): RuntimeUnit | undefined {
  return [...units].sort((a, b) => a.hp / getStat(a, 'hp') - b.hp / getStat(b, 'hp') || a.position - b.position)[0];
}

function selectTargets(
  actor: RuntimeUnit,
  skill: ActiveSkill,
  units: RuntimeUnit[],
  rng: RandomSource,
): RuntimeUnit[] {
  const allies = units.filter((unit) => unit.side === actor.side && isAlive(unit));
  const enemies = units.filter((unit) => unit.side === opposite(actor.side) && isAlive(unit));
  const deadAllies = units.filter((unit) => unit.side === actor.side && !isAlive(unit) && !unit.reviveUsed);

  if (skill.target === 'enemy_single' && getStatus(actor, 'confusion')) {
    const candidates = units.filter((unit) => isAlive(unit) && unit !== actor);
    return candidates.length ? [candidates[rng.integer(candidates.length)]!] : [];
  }
  switch (skill.target) {
    case 'enemy_single': {
      const target = weightedTarget(enemies, rng);
      return target ? [target] : [];
    }
    case 'enemy_all':
      return enemies;
    case 'enemy_random_n': {
      const targets: RuntimeUnit[] = [];
      for (let i = 0; i < (skill.hits ?? 1); i += 1) {
        const target = weightedTarget(enemies, rng);
        if (target) targets.push(target);
      }
      return targets;
    }
    case 'enemy_lowest_hp': {
      const target = lowestHp(enemies);
      return target ? [target] : [];
    }
    case 'ally_single':
    case 'ally_lowest_hp': {
      const target = lowestHp(allies);
      return target ? [target] : [];
    }
    case 'ally_all':
      return allies;
    case 'ally_dead':
      return deadAllies.length ? [deadAllies.sort((a, b) => a.position - b.position)[0]!] : [];
    case 'self':
      return [actor];
  }
}

function skillHasValidTarget(actor: RuntimeUnit, skill: ActiveSkill, units: RuntimeUnit[]): boolean {
  if (skill.target === 'ally_dead') return units.some((unit) => unit.side === actor.side && !isAlive(unit) && !unit.reviveUsed);
  if (skill.target.startsWith('enemy')) return units.some((unit) => unit.side !== actor.side && isAlive(unit));
  return isAlive(actor);
}

function chooseSkill(actor: RuntimeUnit, units: RuntimeUnit[]): { skill: ActiveSkill; slot: number | undefined } {
  const silenced = Boolean(getStatus(actor, 'silence'));
  const choices = actor.setup.skills
    .map((entry, slot) => ({ ...entry, slot }))
    .filter(({ skill, slot }) => actor.cooldowns[slot] === 0 && !(silenced && skill.category === 'magical'))
    .filter(({ skill }) => skillHasValidTarget(actor, skill, units))
    .sort((a, b) => b.priority - a.priority || a.slot - b.slot);
  const selected = choices[0];
  return selected ? { skill: selected.skill, slot: selected.slot } : { skill: NORMAL_ATTACK, slot: undefined };
}

function skillPowerMultiplier(actor: RuntimeUnit, skill: ActiveSkill): number {
  if (!['physical', 'magical', 'heal'].includes(skill.category)) return 1;
  return 1 + actor.passiveEffects
    .filter(
      (effect): effect is Extract<PassiveEffect, { kind: 'skill_power' }> =>
        effect.kind === 'skill_power' && effect.category === skill.category,
    )
    .reduce((sum, effect) => sum + effect.amount, 0);
}

function hitLands(actor: RuntimeUnit, target: RuntimeUnit, skill: ActiveSkill, rng: RandomSource): boolean {
  if (skill.sureHit || !['physical', 'magical'].includes(skill.category)) return true;
  const evade = clamp((getStat(target, 'evade') - getStat(actor, 'accuracy')) / 100, 0, 0.5);
  return !rng.chance(evade);
}

function dealDamage(actor: RuntimeUnit, target: RuntimeUnit, skill: ActiveSkill, rng: RandomSource): number {
  if (!hitLands(actor, target, skill, rng)) return 0;
  const physical = skill.category === 'physical';
  const attack = getStat(actor, physical ? 'atk' : 'mag');
  const defense = getStat(target, physical ? 'def' : 'mdef');
  const critical = rng.chance(getStat(actor, 'crit') / 100);
  const variation = 0.95 + rng.next() * 0.1;
  const raw = attack * skill.power * skillPowerMultiplier(actor, skill) * (attack / (attack + defense));
  const damage = Math.max(1, Math.floor(raw * (critical ? 1.5 : 1) * variation));
  const actual = Math.min(target.hp, damage);
  target.hp -= actual;
  actor.damageDealt += actual;
  target.damageTaken += actual;
  if (actual > 0) removeStatus(target, 'sleep');
  if (!isAlive(target)) knockOut(target);
  return actual;
}

function heal(actor: RuntimeUnit, target: RuntimeUnit, skill: ActiveSkill, rng: RandomSource): number {
  const variation = 0.95 + rng.next() * 0.1;
  const amount = Math.max(1, Math.floor(getStat(actor, 'mag') * skill.power * skillPowerMultiplier(actor, skill) * variation));
  const actual = Math.min(getStat(target, 'hp') - target.hp, amount);
  target.hp += actual;
  return actual;
}

function knockOut(unit: RuntimeUnit): void {
  unit.hp = 0;
  unit.gauge = 0;
  unit.statuses = [];
  unit.modifiers = [];
}

function revive(target: RuntimeUnit, skill: ActiveSkill): boolean {
  if (isAlive(target) || target.reviveUsed) return false;
  target.hp = Math.max(1, Math.floor(getStat(target, 'hp') * (skill.reviveHpRatio ?? 0.3)));
  target.gauge = 0;
  target.reviveUsed = true;
  return true;
}

function applySkillEffects(target: RuntimeUnit, effects: BattleEffect[] | undefined, rng: RandomSource): void {
  for (const effect of effects ?? []) {
    if (effect.kind === 'status') {
      const resistance = statusResistance(target, effect.status.type);
      if (rng.chance(effect.status.chance * (1 - resistance))) {
        applyStatus(target, effect.status.type, effect.status.duration);
      }
    } else if (effect.kind === 'modifier') {
      applyModifier(target, effect.modifier.stat, effect.modifier.amount, effect.modifier.duration);
    } else if (effect.kind === 'gauge') {
      target.gauge = Math.max(0, target.gauge + effect.amount);
    } else {
      applyModifier(target, 'hate', effect.amount, effect.duration);
    }
  }
}

interface SkillResolution {
  summary: string;
  targets: DebugTargetEvent[];
  revivals: Omit<RevivalRecord, 'turn' | 'reviverId' | 'reviverName'>[];
}

function stateChanges(before: RuntimeUnit, after: RuntimeUnit): string[] {
  const changes: string[] = [];
  for (const status of after.statuses) {
    const previous = before.statuses.find((entry) => entry.type === status.type);
    if (!previous || previous.remaining !== status.remaining) changes.push(`${status.type}:残り${status.remaining}`);
  }
  for (const modifier of after.modifiers.slice(before.modifiers.length)) {
    changes.push(`${modifier.stat}:${modifier.amount >= 0 ? '+' : ''}${modifier.amount}:残り${modifier.remaining}`);
  }
  if (before.hp > 0 && after.hp === 0) changes.push('戦闘不能');
  if (before.hp === 0 && after.hp > 0) changes.push('蘇生済み');
  return changes;
}

function debugTarget(before: RuntimeUnit, after: RuntimeUnit): DebugTargetEvent {
  return {
    targetId: after.setup.id,
    targetName: after.setup.name,
    damage: Math.max(0, before.hp - after.hp),
    healing: Math.max(0, after.hp - before.hp),
    stateChanges: stateChanges(before, after),
  };
}

function executeSkill(actor: RuntimeUnit, skill: ActiveSkill, units: RuntimeUnit[], rng: RandomSource): SkillResolution {
  const targets = skill.target === 'enemy_random_n' ? [] : selectTargets(actor, skill, units, rng);
  const summaries: string[] = [];
  const targetEvents: DebugTargetEvent[] = [];
  const revivals: SkillResolution['revivals'] = [];
  const hitCount = skill.target === 'enemy_random_n' ? (skill.hits ?? 1) : targets.length;
  for (let hit = 0; hit < hitCount; hit += 1) {
    const target = skill.target === 'enemy_random_n'
      ? weightedTarget(units.filter((unit) => unit.side === opposite(actor.side) && isAlive(unit)), rng)
      : targets[hit];
    if (!target) continue;
    const before = { ...target, statuses: target.statuses.map((status) => ({ ...status })), modifiers: target.modifiers.map((modifier) => ({ ...modifier })) };
    if (skill.category === 'physical' || skill.category === 'magical') {
      const damage = dealDamage(actor, target, skill, rng);
      summaries.push(damage ? `${target.setup.name}に${damage}ダメージ` : `${target.setup.name}は回避`);
      if (damage > 0 && isAlive(target)) applySkillEffects(target, skill.effects, rng);
    } else if (skill.category === 'heal') {
      summaries.push(`${target.setup.name}を${heal(actor, target, skill, rng)}回復`);
      applySkillEffects(target, skill.effects, rng);
    } else if (skill.category === 'revive') {
      const revived = revive(target, skill);
      summaries.push(revived ? `${target.setup.name}を蘇生（HP ${target.hp}）` : `${target.setup.name}への蘇生失敗`);
      if (revived) revivals.push({ targetId: target.setup.id, targetName: target.setup.name, restoredHp: target.hp });
    } else {
      applySkillEffects(target, skill.effects, rng);
      summaries.push(`${target.setup.name}に効果を付与`);
    }
    targetEvents.push(debugTarget(before, target));
  }
  return { summary: summaries.join('、') || '対象なし', targets: targetEvents, revivals };
}

function damageFromEnvironment(unit: RuntimeUnit, amount: number): void {
  if (!isAlive(unit) || amount <= 0) return;
  const actual = Math.min(unit.hp, Math.max(1, Math.floor(amount)));
  unit.hp -= actual;
  unit.damageTaken += actual;
  if (!isAlive(unit)) knockOut(unit);
}

function finishAction(unit: RuntimeUnit): void {
  if (isAlive(unit)) {
    if (getStatus(unit, 'poison')) damageFromEnvironment(unit, getStat(unit, 'hp') * 0.05);
    if (isAlive(unit) && getStatus(unit, 'burn')) damageFromEnvironment(unit, getStat(unit, 'hp') * 0.03);
    for (const effect of unit.passiveEffects) {
      if (isAlive(unit) && effect.kind === 'action_end_damage') {
        damageFromEnvironment(unit, getStat(unit, 'hp') * effect.maxHpRatio);
      }
    }
  }
  unit.cooldowns = unit.cooldowns.map((cooldown) => Math.max(0, cooldown - 1));
  unit.statuses = unit.statuses
    .map((status) => ({ ...status, remaining: status.remaining - 1 }))
    .filter((status) => status.remaining > 0);
  unit.modifiers = unit.modifiers
    .map((modifier) => ({ ...modifier, remaining: modifier.remaining - 1 }))
    .filter((modifier) => modifier.remaining > 0);
}

function nextActor(units: RuntimeUnit[]): RuntimeUnit | undefined {
  return units
    .filter((unit) => isAlive(unit) && unit.gauge >= 1000)
    .sort((a, b) =>
      b.gauge - a.gauge ||
      getStat(b, 'spd') - getStat(a, 'spd') ||
      (a.side === b.side ? 0 : a.side === 'attackers' ? -1 : 1) ||
      a.position - b.position,
    )[0];
}

function advanceGauges(units: RuntimeUnit[]): void {
  for (const unit of units) if (isAlive(unit)) unit.gauge += getStat(unit, 'spd');
}

function statusSnapshots(unit: RuntimeUnit): StatusSnapshot[] {
  return unit.statuses.map(({ type, remaining }) => ({ type, remaining }));
}

function modifierSnapshots(unit: RuntimeUnit): ModifierSnapshot[] {
  return unit.modifiers.map(({ stat, remaining, amount }) => ({ stat, remaining, amount }));
}

function unitSnapshot(unit: RuntimeUnit): UnitSnapshot {
  const snapshot: UnitSnapshot = {
    id: unit.setup.id,
    name: unit.setup.name,
    kind: unit.setup.kind,
    side: unit.side,
    position: unit.position,
    hp: unit.hp,
    maxHp: getStat(unit, 'hp'),
    knockedOut: !isAlive(unit),
    statuses: statusSnapshots(unit),
    modifiers: modifierSnapshots(unit),
    actionCount: unit.actionCount,
    damageDealt: unit.damageDealt,
    damageTaken: unit.damageTaken,
    reviveUsed: unit.reviveUsed,
  };
  if (unit.setup.icon !== undefined) snapshot.icon = unit.setup.icon;
  return snapshot;
}

function makeSnapshot(turn: number, units: RuntimeUnit[]): Snapshot {
  return { turn, units: units.map(unitSnapshot) };
}

function sideWiped(units: RuntimeUnit[], side: Side): boolean {
  return units.filter((unit) => unit.side === side).every((unit) => !isAlive(unit));
}

function carryOut(units: RuntimeUnit[]): CarryOver {
  return Object.fromEntries(
    units.map((unit) => [
      unit.setup.id,
      { hp: unit.hp, knockedOut: !isAlive(unit), reviveUsed: unit.reviveUsed },
    ]),
  );
}

/** Runs one complete, deterministic, DOM-free battle. */
export function runBattle(input: BattleInput): BattleOutput {
  validateInput(input);
  const rng = mulberry32(input.seed);
  const ruleEffects = input.rules.flatMap((rule) => rule.effects);
  const globalEffects = ruleEffects.filter(isPassiveEffect);
  const units = [
    ...input.attackers.map((setup, position) => createRuntimeUnit(setup, 'attackers', position, globalEffects, input.carryOver)),
    ...input.defenders.map((setup, position) => createRuntimeUnit(setup, 'defenders', position, globalEffects, input.carryOver)),
  ];
  const battleStartEffects = ruleEffects.filter((effect): effect is BattleEffect => !isPassiveEffect(effect));
  for (const unit of units) applySkillEffects(unit, battleStartEffects, rng);
  const snapshots: Snapshot[] = [];
  const events: BattleEvent[] = [];
  const revivals: RevivalRecord[] = [];
  const debugEvents: DebugBattleEvent[] = [];
  let turn = 0;

  while (turn < input.maxTurns && !sideWiped(units, 'attackers') && !sideWiped(units, 'defenders')) {
    let actor = nextActor(units);
    if (!actor) {
      advanceGauges(units);
      actor = nextActor(units);
      if (!actor) continue;
    }

    actor.gauge -= 1000;
    actor.actionCount += 1;
    turn += 1;
    let skillName = '行動不能';
    let summary = '行動できなかった';
    let debugTargets: DebugTargetEvent[] = [];
    const cannotAct = Boolean(getStatus(actor, 'stun') || getStatus(actor, 'sleep')) ||
      (Boolean(getStatus(actor, 'paralysis')) && rng.chance(0.5));

    if (!cannotAct) {
      const { skill, slot } = chooseSkill(actor, units);
      skillName = skill.name;
      const resolution = executeSkill(actor, skill, units, rng);
      summary = resolution.summary;
      debugTargets = resolution.targets;
      revivals.push(...resolution.revivals.map((record) => ({
        turn,
        reviverId: actor.setup.id,
        reviverName: actor.setup.name,
        ...record,
      })));
      if (slot !== undefined) actor.cooldowns[slot] = skill.cooldown;
    }
    events.push({ turn, actorId: actor.setup.id, actorName: actor.setup.name, skillName, summary });
    if (input.debug) debugEvents.push({ turn, actorId: actor.setup.id, actorName: actor.setup.name, skillName, targets: debugTargets });
    finishAction(actor);

    if (turn % input.snapshotInterval === 0) snapshots.push(makeSnapshot(turn, units));
  }

  const defendersWiped = sideWiped(units, 'defenders');
  const attackersWiped = sideWiped(units, 'attackers');
  const timedOut = !defendersWiped && !attackersWiped;
  if (!snapshots.length || snapshots.at(-1)?.turn !== turn) snapshots.push(makeSnapshot(turn, units));

  return {
    result: defendersWiped ? 'win' : 'lose',
    reason: timedOut ? 'timeout' : 'wipe',
    endTurn: turn,
    snapshots,
    carryOut: carryOut(units),
    revivals,
    events,
    ...(input.debug ? { debugEvents } : {}),
  };
}
