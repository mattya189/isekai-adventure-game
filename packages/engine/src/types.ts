export type Side = 'attackers' | 'defenders';
export type BattleResult = 'win' | 'lose';
export type BattleReason = 'wipe' | 'timeout';
export type SkillCategory = 'physical' | 'magical' | 'heal' | 'support' | 'revive';
export type TargetType =
  | 'enemy_single'
  | 'enemy_all'
  | 'enemy_random_n'
  | 'enemy_lowest_hp'
  | 'ally_single'
  | 'ally_all'
  | 'ally_lowest_hp'
  | 'ally_dead'
  | 'self';
export type StatusType = 'poison' | 'burn' | 'stun' | 'sleep' | 'paralysis' | 'silence' | 'confusion';
export type StatKey = 'hp' | 'atk' | 'def' | 'mag' | 'mdef' | 'spd' | 'crit' | 'evade' | 'accuracy' | 'hate';
export type BuffStatKey = Exclude<StatKey, 'hp' | 'hate'>;

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  mag: number;
  mdef: number;
  spd: number;
  crit: number;
  evade: number;
  accuracy: number;
  hate: number;
}

export interface StatusEffectDefinition {
  type: StatusType;
  chance: number;
  duration: number;
}

export interface ModifierEffectDefinition {
  stat: BuffStatKey;
  amount: number;
  duration: number;
}

export type BattleEffect =
  | { kind: 'status'; status: StatusEffectDefinition }
  | { kind: 'modifier'; modifier: ModifierEffectDefinition }
  | { kind: 'gauge'; amount: number }
  | { kind: 'hate'; amount: number; duration: number };

export interface ActiveSkill {
  id: string;
  name: string;
  category: SkillCategory;
  power: number;
  target: TargetType;
  hits?: number;
  cooldown: number;
  sureHit?: boolean;
  effects?: BattleEffect[];
  reviveHpRatio?: number;
}

export type PassiveEffect =
  | { kind: 'stat'; stat: StatKey; amount: number }
  | { kind: 'initial_gauge'; amount: number }
  | { kind: 'status_resistance'; status?: StatusType; amount: number }
  | { kind: 'action_end_damage'; maxHpRatio: number }
  | { kind: 'skill_power'; category: 'physical' | 'magical' | 'heal'; amount: number };

export type RuleEffect = PassiveEffect | BattleEffect;

export interface PassiveSkill {
  id: string;
  name: string;
  trigger: 'always' | 'battle_start' | 'on_action_end' | 'on_hit' | 'on_ally_down';
  effects: PassiveEffect[];
}

export interface EquippedSkill {
  skill: ActiveSkill;
  priority: 0 | 1 | 2 | 3;
}

export interface UnitSetup {
  id: string;
  name: string;
  kind: 'human' | 'monster';
  icon?: string;
  stats: Stats;
  skills: EquippedSkill[];
  passives: PassiveSkill[];
}

export interface WorldRule {
  id: string;
  name: string;
  effects: RuleEffect[];
}

export interface CarryOverUnit {
  hp: number;
  knockedOut: boolean;
  reviveUsed: boolean;
}

export type CarryOver = Record<string, CarryOverUnit>;

export interface BattleInput {
  seed: number;
  attackers: UnitSetup[];
  defenders: UnitSetup[];
  rules: WorldRule[];
  carryOver?: CarryOver;
  maxTurns: number;
  snapshotInterval: number;
  debug?: boolean;
}

export interface StatusSnapshot {
  type: StatusType;
  remaining: number;
}

export interface ModifierSnapshot {
  stat: BuffStatKey | 'hate';
  remaining: number;
  amount: number;
}

export interface UnitSnapshot {
  id: string;
  name: string;
  kind: 'human' | 'monster';
  icon?: string;
  side: Side;
  position: number;
  hp: number;
  maxHp: number;
  knockedOut: boolean;
  statuses: StatusSnapshot[];
  modifiers: ModifierSnapshot[];
  actionCount: number;
  damageDealt: number;
  damageTaken: number;
  reviveUsed: boolean;
}

export interface Snapshot {
  turn: number;
  units: UnitSnapshot[];
}

export interface BattleEvent {
  turn: number;
  actorId: string;
  actorName: string;
  skillName: string;
  summary: string;
}

export interface RevivalRecord {
  turn: number;
  reviverId: string;
  reviverName: string;
  targetId: string;
  targetName: string;
  restoredHp: number;
}

export interface DebugTargetEvent {
  targetId: string;
  targetName: string;
  damage: number;
  healing: number;
  stateChanges: string[];
}

export interface DebugBattleEvent {
  turn: number;
  actorId: string;
  actorName: string;
  skillName: string;
  targets: DebugTargetEvent[];
}

export interface BattleOutput {
  result: BattleResult;
  reason: BattleReason;
  endTurn: number;
  snapshots: Snapshot[];
  carryOut: CarryOver;
  revivals: RevivalRecord[];
  events: BattleEvent[];
  debugEvents?: DebugBattleEvent[];
}
