import { describe, expect, it } from 'vitest';
import { runBattle } from '../src/battle';
import { runBattleBatch } from '../src/batch';
import { createScenarioBattleInput, sampleScenarios } from '../src/sample';

describe('demo battle scenarios', () => {
  it('provides the four requested test formations', () => {
    expect(sampleScenarios.map(({ id }) => id)).toEqual(['balanced', 'fortress', 'revival', 'status']);
  });

  it('uses the 200-turn default and stores four 50-turn snapshots on fortress timeout', () => {
    const result = runBattle(createScenarioBattleInput('fortress', 123));
    expect(result).toMatchObject({ result: 'lose', reason: 'timeout', endTurn: 200 });
    expect(result.snapshots.map(({ turn }) => turn)).toEqual([50, 100, 150, 200]);
  });

  it('includes a working revive formation', () => {
    const results = Array.from({ length: 20 }, (_, seed) => runBattle(createScenarioBattleInput('revival', seed)));
    expect(results.some((result) => result.events.some((event) => event.summary.includes('蘇生')))).toBe(true);
  });

  it('includes statuses and both positive and negative modifiers', () => {
    const results = Array.from({ length: 10 }, (_, seed) => runBattle(createScenarioBattleInput('status', seed)));
    const units = results.flatMap((result) => result.snapshots.flatMap((snapshot) => snapshot.units));
    expect(units.some((unit) => unit.statuses.length > 0)).toBe(true);
    expect(units.some((unit) => unit.modifiers.some((modifier) => modifier.amount > 0))).toBe(true);
    expect(units.some((unit) => unit.modifiers.some((modifier) => modifier.amount < 0))).toBe(true);
  });
});

describe('100 battle summary', () => {
  it('aggregates wins, average turns, and timeout rate deterministically', () => {
    const scenario = sampleScenarios.find(({ id }) => id === 'fortress')!;
    const summary = runBattleBatch(scenario.createInput, 500, 100);
    expect(summary).toEqual({
      battles: 100,
      wins: 0,
      winRate: 0,
      averageEndTurn: 200,
      timeouts: 100,
      timeoutRate: 1,
    });
    expect(runBattleBatch(scenario.createInput, 500, 100)).toEqual(summary);
  });

  it('rejects an invalid battle count', () => {
    expect(() => runBattleBatch(sampleScenarios[0]!.createInput, 1, 0)).toThrow(/positive integer/);
  });
});
