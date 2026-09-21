import './style.css';
import { createSampleBattleInput } from './sample';
import { runBattle } from './battle';
import type { BattleOutput, Snapshot, UnitSnapshot } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#detail-dialog')!;
let seed = 20260921;
let output: BattleOutput = runBattle(createSampleBattleInput(seed));
let page = 0;

const labels: Record<string, string> = {
  poison: '毒', burn: '火傷', stun: 'スタン', sleep: '睡眠', paralysis: '麻痺', silence: '沈黙', confusion: '混乱',
  atk: '攻撃', def: '防御', mag: '魔力', mdef: '魔防', spd: '素早さ', crit: '会心率', evade: '回避率', accuracy: '命中率', hate: 'ヘイト',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function icon(unit: UnitSnapshot): string {
  return `<span class="avatar ${unit.side}" aria-hidden="true">${escapeHtml(unit.name.slice(0, 1))}</span>`;
}

function card(unit: UnitSnapshot): string {
  const ratio = Math.max(0, unit.hp / unit.maxHp * 100);
  const states = [...unit.statuses.map((item) => labels[item.type]), ...unit.modifiers.map((item) => labels[item.stat])];
  return `<button class="unit-card ${unit.knockedOut ? 'down' : ''}" data-unit="${escapeHtml(unit.id)}">
    ${icon(unit)}
    <span class="unit-copy"><strong>${escapeHtml(unit.name)}</strong><small>${unit.kind === 'human' ? '人間' : 'モンスター'}・行動${unit.actionCount}回</small>
      <span class="hp"><i style="width:${ratio}%"></i></span><small>HP ${unit.hp.toLocaleString()} / ${unit.maxHp.toLocaleString()}</small>
      <span class="chips">${unit.knockedOut ? '<em>戦闘不能</em>' : states.slice(0, 3).map((state) => `<em>${state}</em>`).join('')}</span>
    </span>
  </button>`;
}

function team(snapshot: Snapshot, side: 'attackers' | 'defenders', title: string): string {
  return `<section><h2>${title}</h2><div class="team">${snapshot.units.filter((unit) => unit.side === side).map(card).join('')}</div></section>`;
}

function render(): void {
  const snapshot = output.snapshots[page]!;
  app.innerHTML = `<header><p class="eyebrow">PHASE 1 / ENGINE TEST</p><h1>戦闘スナップショット</h1><p>同じシードなら、いつでも同じ結果になります。</p></header>
    <section class="result"><div><small>結果</small><strong class="${output.result}">${output.result === 'win' ? '勝利' : '敗北'}</strong></div><div><small>決着</small><strong>${output.endTurn}ターン</strong></div><div><small>理由</small><strong>${output.reason === 'wipe' ? '全滅' : '時間切れ'}</strong></div></section>
    <nav class="pager"><button id="prev" ${page === 0 ? 'disabled' : ''}>‹ 前</button><b>${snapshot.turn}ターン時点</b><button id="next" ${page === output.snapshots.length - 1 ? 'disabled' : ''}>次 ›</button></nav>
    ${team(snapshot, 'attackers', '味方パーティ')}${team(snapshot, 'defenders', '敵パーティ')}
    <section class="seed"><label for="seed">シード</label><input id="seed" inputmode="numeric" value="${seed}"><button id="rerun">再戦する</button></section>
    <details><summary>直近の行動ログ</summary><ol>${output.events.slice(Math.max(0, snapshot.turn - 8), snapshot.turn).map((event) => `<li><b>${event.turn}T ${escapeHtml(event.actorName)}</b><span>${escapeHtml(event.skillName)}：${escapeHtml(event.summary)}</span></li>`).join('')}</ol></details>
    <footer>キャラクターをタップすると詳細を確認できます。</footer>`;
  document.querySelector<HTMLButtonElement>('#prev')?.addEventListener('click', () => { page -= 1; render(); });
  document.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => { page += 1; render(); });
  document.querySelector<HTMLButtonElement>('#rerun')?.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>('#seed')!;
    seed = Number.parseInt(input.value, 10) || 0;
    output = runBattle(createSampleBattleInput(seed));
    page = 0;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('.unit-card').forEach((element) => element.addEventListener('click', () => {
    const unit = snapshot.units.find((entry) => entry.id === element.dataset.unit);
    if (unit) showDetail(unit);
  }));
}

function showDetail(unit: UnitSnapshot): void {
  const statuses = unit.statuses.length ? unit.statuses.map((item) => `<li>${labels[item.type]}：残り${item.remaining}回</li>`).join('') : '<li>なし</li>';
  const modifiers = unit.modifiers.length ? unit.modifiers.map((item) => `<li>${labels[item.stat]}：${item.amount > 0 ? '+' : ''}${Math.round(item.amount * 100)}%（残り${item.remaining}回）</li>`).join('') : '<li>なし</li>';
  dialog.innerHTML = `<div class="dialog-head">${icon(unit)}<div><small>${unit.side === 'attackers' ? '味方' : '敵'}</small><h2>${escapeHtml(unit.name)}</h2></div></div>
    <dl><div><dt>与ダメージ累計</dt><dd>${unit.damageDealt.toLocaleString()}</dd></div><div><dt>被ダメージ累計</dt><dd>${unit.damageTaken.toLocaleString()}</dd></div><div><dt>蘇生使用</dt><dd>${unit.reviveUsed ? '使用済み' : '未使用'}</dd></div></dl>
    <h3>状態異常</h3><ul>${statuses}</ul><h3>バフ・デバフ</h3><ul>${modifiers}</ul><button id="close-dialog">閉じる</button>`;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('#close-dialog')?.addEventListener('click', () => dialog.close());
}

dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
render();
