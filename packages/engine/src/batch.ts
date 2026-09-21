import { runBattle } from './battle';
import type { BattleInput } from './types';

export interface BattleBatchSummary {
  battles: number;
  wins: number;
  winRate: number;
  averageEndTurn: number;
  timeouts: number;
  timeoutRate: number;
}

export function runBattleBatch(
  createInput: (seed: number) => BattleInput,
  startSeed: number,
  battles = 100,
): BattleBatchSummary {
  if (!Number.isInteger(battles) || battles <= 0) throw new Error('battles must be a positive integer.');

  let wins = 0;
  let timeouts = 0;
  let totalEndTurn = 0;
  for (let index = 0; index < battles; index += 1) {
    const result = runBattle(createInput(startSeed + index));
    if (result.result === 'win') wins += 1;
    if (result.reason === 'timeout') timeouts += 1;
    totalEndTurn += result.endTurn;
  }

  return {
    battles,
    wins,
    winRate: wins / battles,
    averageEndTurn: totalEndTurn / battles,
    timeouts,
    timeoutRate: timeouts / battles,
  };
}
