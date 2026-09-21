import './style.css';
import { runBattle } from './battle';
import { runBattleBatch, type BattleBatchSummary } from './batch';
import { createScenarioBattleInput, DEFAULT_MAX_TURNS, sampleScenarios, type SampleScenario } from './sample';
import type { BattleOutput, ModifierSnapshot, Snapshot, StatusSnapshot, UnitSnapshot } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#detail-dialog')!;
let seed = 20260921;
let maxTurns = DEFAULT_MAX_TURNS;
let scenarioId: SampleScenario['id'] = 'balanced';
let output: BattleOutput = runBattle(createBattleInput(seed));
let page = 0;
let batchSummary: BattleBatchSummary | undefined;
let batchRunning = false;

const labels: Record<string, string> = {
  poison: '毒', burn: '火傷', stun: 'スタン', sleep: '睡眠', paralysis: '麻痺', silence: '沈黙', confusion: '混乱',
  atk: '攻撃', def: '防御', mag: '魔力', mdef: '魔防', spd: '素早さ', crit: '会心率', evade: '回避率', accuracy: '命中率', hate: 'ヘイト',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function currentScenario(): SampleScenario {
  return sampleScenarios.find((scenario) => scenario.id === scenarioId) ?? sampleScenarios[0]!;
}

function createBattleInput(battleSeed: number) {
  return { ...createScenarioBattleInput(scenarioId, battleSeed), maxTurns };
}

function label(key: string): string {
  return labels[key] ?? key;
}

function icon(unit: UnitSnapshot): string {
  return `<span class="avatar ${unit.side}" aria-hidden="true">${escapeHtml(unit.name.slice(0, 1))}</span>`;
}

function statusChip(item: StatusSnapshot): string {
  return `<em class="negative" title="${escapeHtml(label(item.type))}、残り${item.remaining}回"><b>↓</b> ${escapeHtml(label(item.type))}・残${item.remaining}</em>`;
}

function modifierChip(item: ModifierSnapshot): string {
  const direction = item.amount >= 0 ? '↑' : '↓';
  const tone = item.amount >= 0 ? 'positive' : 'negative';
  return `<em class="${tone}" title="${escapeHtml(label(item.stat))}${direction}、残り${item.remaining}回"><b>${direction}</b> ${escapeHtml(label(item.stat))}・残${item.remaining}</em>`;
}

function card(unit: UnitSnapshot): string {
  const ratio = Math.max(0, unit.hp / unit.maxHp * 100);
  const states = [...unit.statuses.map(statusChip), ...unit.modifiers.map(modifierChip)];
  return `<button class="unit-card ${unit.knockedOut ? 'down' : ''}" data-unit="${escapeHtml(unit.id)}">
    ${icon(unit)}
    <span class="unit-copy"><strong>${escapeHtml(unit.name)}</strong><small>${unit.kind === 'human' ? '人間' : 'モンスター'}・行動${unit.actionCount}回</small>
      <span class="hp"><i style="width:${ratio}%"></i></span><small>HP ${unit.hp.toLocaleString()} / ${unit.maxHp.toLocaleString()}</small>
      <span class="chips">${unit.knockedOut ? '<em>戦闘不能</em>' : states.slice(0, 4).join('')}</span>
    </span>
  </button>`;
}

function team(snapshot: Snapshot, side: 'attackers' | 'defenders', title: string): string {
  return `<section><h2>${title}</h2><div class="team">${snapshot.units.filter((unit) => unit.side === side).map(card).join('')}</div></section>`;
}

function scenarioOptions(): string {
  return sampleScenarios.map((scenario) => `<option value="${scenario.id}" ${scenario.id === scenarioId ? 'selected' : ''}>${escapeHtml(scenario.name)}</option>`).join('');
}

function batchPanel(): string {
  if (batchRunning) return '<div class="batch-output loading" aria-live="polite">100戦を計算中…</div>';
  if (!batchSummary) return '<div class="batch-output empty" aria-live="polite">一括実行すると、ここに集計結果が表示されます。</div>';
  return `<div class="batch-output" aria-live="polite">
    <div><small>勝率</small><strong>${(batchSummary.winRate * 100).toFixed(1)}%</strong><span>${batchSummary.wins}勝 / ${batchSummary.battles}戦</span></div>
    <div><small>平均決着</small><strong>${batchSummary.averageEndTurn.toFixed(1)}T</strong><span>時間切れを含む</span></div>
    <div><small>時間切れ率</small><strong>${(batchSummary.timeoutRate * 100).toFixed(1)}%</strong><span>${batchSummary.timeouts}戦</span></div>
  </div>`;
}

function render(): void {
  const snapshot = output.snapshots[page]!;
  const scenario = currentScenario();
  app.innerHTML = `<header><p class="eyebrow">PHASE 1 / ENGINE TEST</p><h1>戦闘スナップショット</h1><p>同じ編成とシードなら、いつでも同じ結果になります。</p></header>
    <section class="controls" aria-label="テスト条件">
      <label for="scenario">テスト編成</label>
      <select id="scenario">${scenarioOptions()}</select>
      <p>${escapeHtml(scenario.description)}</p>
      <label for="seed">シード値</label>
      <div class="seed-row"><input id="seed" inputmode="numeric" value="${seed}" aria-label="シード値"><button id="random-seed" type="button">ランダム生成</button></div>
      <label for="max-turns">最大ターン数</label>
      <input id="max-turns" type="number" inputmode="numeric" min="1" step="1" value="${maxTurns}" aria-label="最大ターン数">
      <button id="rerun" class="primary" type="button">この条件で再戦する</button>
    </section>
    <section class="result"><div><small>結果</small><strong class="${output.result}">${output.result === 'win' ? '勝利' : '敗北'}</strong></div><div><small>決着</small><strong>${output.endTurn}ターン</strong></div><div><small>理由</small><strong>${output.reason === 'wipe' ? '全滅' : '時間切れ'}</strong></div></section>
    <nav class="pager"><button id="prev" ${page === 0 ? 'disabled' : ''}>‹ 前</button><b>${snapshot.turn}ターン時点</b><button id="next" ${page === output.snapshots.length - 1 ? 'disabled' : ''}>次 ›</button></nav>
    ${team(snapshot, 'attackers', '味方パーティ')}${team(snapshot, 'defenders', '敵パーティ')}
    <section class="batch"><div><h2>100戦一括テスト</h2><p>現在の編成・最大${maxTurns}ターンで、シード${seed}〜${seed + 99}を実行します。</p></div><button id="run-batch" type="button" ${batchRunning ? 'disabled' : ''}>100戦を実行</button>${batchPanel()}</section>
    <details><summary>直近の行動ログ</summary><ol>${output.events.slice(Math.max(0, snapshot.turn - 8), snapshot.turn).map((event) => `<li><b>${event.turn}T ${escapeHtml(event.actorName)}</b><span>${escapeHtml(event.skillName)}：${escapeHtml(event.summary)}</span></li>`).join('')}</ol></details>
    <footer>キャラクターをタップすると状態の詳細を確認できます。</footer>`;

  document.querySelector<HTMLButtonElement>('#prev')?.addEventListener('click', () => { page -= 1; render(); });
  document.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => { page += 1; render(); });
  document.querySelector<HTMLSelectElement>('#scenario')?.addEventListener('change', (event) => {
    maxTurns = readMaxTurns();
    scenarioId = (event.currentTarget as HTMLSelectElement).value as SampleScenario['id'];
    runSingleBattle();
  });
  document.querySelector<HTMLButtonElement>('#random-seed')?.addEventListener('click', () => {
    maxTurns = readMaxTurns();
    seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    runSingleBattle();
  });
  document.querySelector<HTMLButtonElement>('#rerun')?.addEventListener('click', () => {
    seed = readSeed();
    maxTurns = readMaxTurns();
    runSingleBattle();
  });
  document.querySelector<HTMLButtonElement>('#run-batch')?.addEventListener('click', async () => {
    seed = readSeed();
    maxTurns = readMaxTurns();
    batchRunning = true;
    render();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    batchSummary = runBattleBatch(createBattleInput, seed, 100);
    batchRunning = false;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('.unit-card').forEach((element) => element.addEventListener('click', () => {
    const unit = snapshot.units.find((entry) => entry.id === element.dataset.unit);
    if (unit) showDetail(unit);
  }));
}

function readSeed(): number {
  const value = document.querySelector<HTMLInputElement>('#seed')?.value ?? '0';
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readMaxTurns(): number {
  const value = document.querySelector<HTMLInputElement>('#max-turns')?.value ?? '';
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TURNS;
}

function runSingleBattle(): void {
  output = runBattle(createBattleInput(seed));
  page = 0;
  batchSummary = undefined;
  render();
}

function showDetail(unit: UnitSnapshot): void {
  const statuses = unit.statuses.length ? unit.statuses.map((item) => `<li><b class="down-arrow">↓</b> ${label(item.type)}（残り${item.remaining}回）</li>`).join('') : '<li>なし</li>';
  const modifiers = unit.modifiers.length ? unit.modifiers.map((item) => {
    const direction = item.amount >= 0 ? '↑' : '↓';
    const tone = item.amount >= 0 ? 'up-arrow' : 'down-arrow';
    const amount = item.stat === 'hate' ? Math.abs(item.amount).toString() : `${Math.round(Math.abs(item.amount) * 100)}%`;
    return `<li><b class="${tone}">${direction}</b> ${label(item.stat)} ${amount}（残り${item.remaining}回）</li>`;
  }).join('') : '<li>なし</li>';
  dialog.innerHTML = `<div class="dialog-head">${icon(unit)}<div><small>${unit.side === 'attackers' ? '味方' : '敵'}</small><h2>${escapeHtml(unit.name)}</h2></div></div>
    <dl><div><dt>与ダメージ累計</dt><dd>${unit.damageDealt.toLocaleString()}</dd></div><div><dt>被ダメージ累計</dt><dd>${unit.damageTaken.toLocaleString()}</dd></div><div><dt>蘇生使用</dt><dd>${unit.reviveUsed ? '使用済み' : '未使用'}</dd></div></dl>
    <h3>状態異常</h3><ul>${statuses}</ul><h3>バフ・デバフ</h3><ul>${modifiers}</ul><button id="close-dialog">閉じる</button>`;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('#close-dialog')?.addEventListener('click', () => dialog.close());
}

dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
render();
