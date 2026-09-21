import { runBattle } from './battle';
import type { ActiveSkill, BattleInput, EquippedSkill, PassiveSkill, UnitSetup, WorldRule } from './types';

const skill = (value: ActiveSkill, priority: 0 | 1 | 2 | 3): EquippedSkill => ({ skill: value, priority });

export const DEFAULT_MAX_TURNS = 200;
export const DEFAULT_SNAPSHOT_INTERVAL = 50;

const slash: ActiveSkill = {
  id: 'slash', name: '斬撃', category: 'physical', power: 1.25, target: 'enemy_single', cooldown: 2,
};
const shieldBash: ActiveSkill = {
  id: 'shield_bash', name: '盾撃', category: 'physical', power: 0.85, target: 'enemy_single', cooldown: 4,
  effects: [{ kind: 'status', status: { type: 'stun', chance: 0.45, duration: 1 } }],
};
const provoke: ActiveSkill = {
  id: 'provoke', name: '挑発', category: 'support', power: 0, target: 'self', cooldown: 4,
  effects: [
    { kind: 'hate', amount: 5, duration: 3 },
    { kind: 'modifier', modifier: { stat: 'def', amount: 0.3, duration: 3 } },
  ],
};
const fireball: ActiveSkill = {
  id: 'fireball', name: '火球', category: 'magical', power: 1.4, target: 'enemy_single', cooldown: 3,
  effects: [{ kind: 'status', status: { type: 'burn', chance: 0.65, duration: 3 } }],
};
const blizzard: ActiveSkill = {
  id: 'blizzard', name: '氷嵐', category: 'magical', power: 0.7, target: 'enemy_all', cooldown: 5,
  effects: [{ kind: 'modifier', modifier: { stat: 'spd', amount: -0.2, duration: 3 } }],
};
const heal: ActiveSkill = {
  id: 'heal', name: '治癒', category: 'heal', power: 1.35, target: 'ally_lowest_hp', cooldown: 3,
};
const revive: ActiveSkill = {
  id: 'revive', name: '再起の祈り', category: 'revive', power: 0, target: 'ally_dead', cooldown: 8, reviveHpRatio: 0.3,
};
const poisonFang: ActiveSkill = {
  id: 'poison_fang', name: '毒牙', category: 'physical', power: 1.05, target: 'enemy_single', cooldown: 2,
  effects: [{ kind: 'status', status: { type: 'poison', chance: 0.75, duration: 4 } }],
};
const wildRush: ActiveSkill = {
  id: 'wild_rush', name: '乱牙連撃', category: 'physical', power: 0.58, target: 'enemy_random_n', hits: 3, cooldown: 4,
};
const darkMist: ActiveSkill = {
  id: 'dark_mist', name: '暗黒の霧', category: 'support', power: 0, target: 'enemy_all', cooldown: 5,
  effects: [{ kind: 'modifier', modifier: { stat: 'accuracy', amount: -0.25, duration: 3 } }],
};
const sleepSong: ActiveSkill = {
  id: 'sleep_song', name: '眠り歌', category: 'magical', power: 0.35, target: 'enemy_all', cooldown: 6,
  effects: [{ kind: 'status', status: { type: 'sleep', chance: 0.32, duration: 2 } }],
};
const weaken: ActiveSkill = {
  id: 'weaken', name: '弱体の呪い', category: 'support', power: 0, target: 'enemy_all', cooldown: 4,
  effects: [
    { kind: 'modifier', modifier: { stat: 'atk', amount: -0.25, duration: 3 } },
    { kind: 'modifier', modifier: { stat: 'def', amount: -0.2, duration: 3 } },
  ],
};
const battleCry: ActiveSkill = {
  id: 'battle_cry', name: '戦陣の号令', category: 'support', power: 0, target: 'ally_all', cooldown: 5,
  effects: [
    { kind: 'modifier', modifier: { stat: 'atk', amount: 0.25, duration: 3 } },
    { kind: 'modifier', modifier: { stat: 'spd', amount: 0.15, duration: 3 } },
  ],
};

const filler = (prefix: string): ActiveSkill[] => [1, 2, 3].map((n) => ({
  id: `${prefix}_basic_${n}`,
  name: `基本技${n}`,
  category: 'physical',
  power: 1 + n * 0.03,
  target: 'enemy_single',
  cooldown: n + 3,
}));

const sturdy: PassiveSkill = { id: 'sturdy', name: '堅牢', trigger: 'always', effects: [{ kind: 'stat', stat: 'def', amount: 0.15 }] };
const quickStart: PassiveSkill = { id: 'quick_start', name: '先手', trigger: 'battle_start', effects: [{ kind: 'initial_gauge', amount: 250 }] };
const antiPoison: PassiveSkill = { id: 'anti_poison', name: '毒耐性', trigger: 'always', effects: [{ kind: 'status_resistance', status: 'poison', amount: 0.6 }] };
const magicFocus: PassiveSkill = { id: 'magic_focus', name: '魔力集中', trigger: 'always', effects: [{ kind: 'skill_power', category: 'magical', amount: 0.15 }] };

function unit(
  id: string,
  name: string,
  kind: 'human' | 'monster',
  stats: UnitSetup['stats'],
  mainSkills: EquippedSkill[],
  passives: PassiveSkill[],
): UnitSetup {
  const extra = filler(id).map((entry) => skill(entry, 0));
  return { id, name, kind, stats, skills: [...mainSkills, ...extra].slice(0, 6), passives };
}

export const sampleAttackers: UnitSetup[] = [
  unit('hero_aria', '騎士アリア', 'human', { hp: 1550, atk: 225, def: 205, mag: 75, mdef: 145, spd: 102, crit: 12, evade: 4, accuracy: 8, hate: 3 }, [skill(provoke, 3), skill(shieldBash, 2), skill(slash, 1)], [sturdy]),
  unit('mage_noel', '魔術師ノエル', 'human', { hp: 980, atk: 70, def: 90, mag: 275, mdef: 190, spd: 111, crit: 16, evade: 7, accuracy: 12, hate: 1 }, [skill(blizzard, 3), skill(fireball, 2)], [quickStart, magicFocus]),
  unit('priest_luna', '神官ルナ', 'human', { hp: 1180, atk: 82, def: 112, mag: 235, mdef: 225, spd: 98, crit: 8, evade: 5, accuracy: 5, hate: 1 }, [skill(revive, 3), skill(heal, 2), skill(slash, 0)], [antiPoison]),
];

export const sampleDefenders: UnitSetup[] = [
  unit('orc_guard', '鉄壁オーク', 'monster', { hp: 1700, atk: 205, def: 215, mag: 55, mdef: 105, spd: 91, crit: 10, evade: 2, accuracy: 5, hate: 3 }, [skill(provoke, 3), skill(shieldBash, 2)], [sturdy, antiPoison]),
  unit('venom_wolf', '毒牙狼', 'monster', { hp: 1050, atk: 245, def: 105, mag: 70, mdef: 95, spd: 126, crit: 18, evade: 12, accuracy: 10, hate: 2 }, [skill(wildRush, 3), skill(poisonFang, 2)], [quickStart]),
  unit('night_witch', '宵闇の魔女', 'monster', { hp: 1020, atk: 65, def: 92, mag: 260, mdef: 205, spd: 108, crit: 14, evade: 8, accuracy: 14, hate: 1 }, [skill(sleepSong, 3), skill(darkMist, 2), skill(fireball, 1)], [magicFocus]),
];

export const sampleRules: WorldRule[] = [
  { id: 'scorching', name: '灼熱', effects: [{ kind: 'action_end_damage', maxHpRatio: 0.02 }] },
];

export function createSampleBattleInput(seed = 20260921): BattleInput {
  return {
    seed,
    attackers: sampleAttackers,
    defenders: sampleDefenders,
    rules: sampleRules,
    maxTurns: DEFAULT_MAX_TURNS,
    snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL,
  };
}

const fortressAttackers: UnitSetup[] = [
  unit('fortress_scout', '試練の斥候', 'human', { hp: 2400, atk: 65, def: 360, mag: 60, mdef: 340, spd: 105, crit: 0, evade: 2, accuracy: 5, hate: 2 }, [skill(slash, 1)], [sturdy, antiPoison]),
  unit('fortress_guard', '試練の守兵', 'human', { hp: 2800, atk: 60, def: 390, mag: 55, mdef: 360, spd: 92, crit: 0, evade: 1, accuracy: 5, hate: 4 }, [skill(provoke, 3), skill(slash, 1)], [sturdy, antiPoison]),
];

const fortressDefenders: UnitSetup[] = [
  unit('adamant_golem', '金剛ゴーレム', 'monster', { hp: 12000, atk: 55, def: 620, mag: 40, mdef: 600, spd: 82, crit: 0, evade: 0, accuracy: 5, hate: 5 }, [skill(provoke, 3), skill(shieldBash, 1)], [sturdy, antiPoison]),
];

const revivalDefenders: UnitSetup[] = [
  unit('fallen_knight', '亡国の騎士', 'monster', { hp: 920, atk: 230, def: 125, mag: 70, mdef: 110, spd: 112, crit: 12, evade: 5, accuracy: 8, hate: 3 }, [skill(shieldBash, 2), skill(slash, 1)], [sturdy]),
  unit('bone_mage', '骨術師モルテ', 'monster', { hp: 760, atk: 55, def: 80, mag: 245, mdef: 185, spd: 106, crit: 8, evade: 4, accuracy: 10, hate: 1 }, [skill(revive, 3), skill(heal, 2), skill(fireball, 1)], [magicFocus]),
  unit('grave_hound', '墓守の猟犬', 'monster', { hp: 820, atk: 250, def: 95, mag: 50, mdef: 90, spd: 128, crit: 16, evade: 9, accuracy: 10, hate: 2 }, [skill(poisonFang, 2), skill(slash, 1)], [quickStart]),
];

const statusAttackers: UnitSetup[] = [
  unit('hexer_iris', '呪術師イリス', 'human', { hp: 1050, atk: 65, def: 105, mag: 255, mdef: 210, spd: 116, crit: 10, evade: 6, accuracy: 12, hate: 1 }, [skill(weaken, 3), skill(sleepSong, 2), skill(fireball, 1)], [magicFocus]),
  unit('banner_rei', '軍師レイ', 'human', { hp: 1280, atk: 155, def: 145, mag: 165, mdef: 160, spd: 108, crit: 8, evade: 5, accuracy: 10, hate: 2 }, [skill(battleCry, 3), skill(blizzard, 2), skill(slash, 1)], [quickStart]),
  unit('apothecary_mia', '薬師ミア', 'human', { hp: 1120, atk: 90, def: 120, mag: 215, mdef: 205, spd: 101, crit: 6, evade: 5, accuracy: 8, hate: 1 }, [skill(heal, 3), skill(poisonFang, 2)], [antiPoison]),
];

const statusDefenders: UnitSetup[] = [
  unit('plague_slime', '疫毒スライム', 'monster', { hp: 1350, atk: 170, def: 145, mag: 180, mdef: 150, spd: 98, crit: 6, evade: 2, accuracy: 8, hate: 3 }, [skill(poisonFang, 3), skill(darkMist, 2)], [antiPoison]),
  unit('dream_moth', '夢喰い蛾', 'monster', { hp: 980, atk: 80, def: 90, mag: 235, mdef: 195, spd: 121, crit: 10, evade: 10, accuracy: 12, hate: 1 }, [skill(sleepSong, 3), skill(blizzard, 2)], [quickStart, magicFocus]),
  unit('ash_imp', '灰火の小鬼', 'monster', { hp: 1050, atk: 120, def: 105, mag: 230, mdef: 125, spd: 109, crit: 12, evade: 6, accuracy: 10, hate: 2 }, [skill(fireball, 3), skill(weaken, 2)], [magicFocus]),
];

export interface SampleScenario {
  id: 'balanced' | 'fortress' | 'revival' | 'status';
  name: string;
  description: string;
  createInput: (seed: number) => BattleInput;
}

export const sampleScenarios: SampleScenario[] = [
  {
    id: 'balanced',
    name: '通常編成',
    description: '攻撃・回復・妨害を含む基本の3対3です。',
    createInput: createSampleBattleInput,
  },
  {
    id: 'fortress',
    name: '鉄壁・時間切れ',
    description: '双方の火力を抑え、硬い敵との時間切れを確認します。',
    createInput: (seed) => ({ seed, attackers: fortressAttackers, defenders: fortressDefenders, rules: [], maxTurns: DEFAULT_MAX_TURNS, snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL }),
  },
  {
    id: 'revival',
    name: '蘇生持ち',
    description: '敵の骨術師が倒れた仲間を一度だけ蘇生します。',
    createInput: (seed) => ({ seed, attackers: sampleAttackers, defenders: revivalDefenders, rules: [], maxTurns: DEFAULT_MAX_TURNS, snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL }),
  },
  {
    id: 'status',
    name: '状態異常中心',
    description: '毒・火傷・睡眠と能力の上昇・低下を多用します。',
    createInput: (seed) => ({ seed, attackers: statusAttackers, defenders: statusDefenders, rules: [], maxTurns: DEFAULT_MAX_TURNS, snapshotInterval: DEFAULT_SNAPSHOT_INTERVAL }),
  },
];

export function createScenarioBattleInput(scenarioId: SampleScenario['id'], seed = 20260921): BattleInput {
  return (sampleScenarios.find((scenario) => scenario.id === scenarioId) ?? sampleScenarios[0]!).createInput(seed);
}

export function runSampleBattle(seed = 20260921) {
  return runBattle(createSampleBattleInput(seed));
}
