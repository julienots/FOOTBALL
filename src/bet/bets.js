// Paris sportifs en argent fictif.
// Deux porte-monnaie : les JETONS (argent qu'on met, rechargeable) et les GAINS
// (argent gagné grâce aux paris). On peut rejouer ses gains, et le bilan compare
// ce qu'on a mis à ce qu'on a gagné.
import { lambdas, marketOdds, evaluate, pickLabel, MARKET_LABEL, EXACT } from './odds.js';
import { footSlotAt, getSeason } from '../data/season.js';
import { fullSim } from '../core/sim-service.js';
import { el, esc, teamBadge } from '../tv/overlay.js';

const KEY = 'sporttv-paris-v1';
const START = 1000;
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return s;
  } catch (e) { /* rien */ }
  return { jetons: START, gains: 0, deposited: START, stakedJ: 0, stakedG: 0, won: 0, bets: [], seq: 1, reloads: 0 };
}

export class BetCenter {
  constructor(app) {
    this.app = app;
    this.w = load();
    this.slip = []; // sélections en cours
    this.stake = 10;
    this.currency = 'jetons';
    this.view = 'matchs';
    this.expanded = null;
    this.matches = [];
    this.lastList = 0;
    setInterval(() => this.settle(), 5000);
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.w)); } catch (e) { /* quota */ } }

  get foot() { return this.app.channels.find(c => c.id === 'foot'); }

  // ---------- Matches disponibles ----------
  async refreshMatches() {
    const k = this.app.settings.speed;
    const now = this.app.now();
    const s = footSlotAt(now, k);
    const out = [];
    for (let i = 0; i < 5; i++) {
      const slot = s.slot + i;
      const start = s.start + i * s.timing.cycle * 1000;
      const kickoff = start + s.timing.pre * 1000;
      try {
        const info = await Promise.race([this.foot.infoForSlot(slot), new Promise(r => setTimeout(() => r(null), 1500))]);
        if (!info) continue;
        out.push({ key: `${k}:${slot}`, k, slot, kickoff, start, info, end: start + s.timing.cycle * 1000 });
      } catch (e) { /* match pas encore déterminé */ }
    }
    this.matches = out;
    this.lastList = Date.now();
  }

  // état et cotes d'un match à l'instant présent
  marketState(m) {
    const now = this.app.now();
    const [lh, la] = lambdas(m.info.home, m.info.away, m.info.neutral);
    const F = this.foot;
    if (now < m.kickoff - 5000) return { open: true, live: false, odds: marketOdds(lh, la), label: `Coup d'envoi ${fmtTime(m.kickoff)}` };
    const E = F && F.slot === m.slot && F.engine;
    if (!E) return { open: false, live: true, label: 'En cours' };
    if (E.period === 'end' || E.period === 'ft' || E.period === 'pens') return { open: false, live: false, done: true, label: 'Terminé', score: E.score };
    const min = E.period === 'ht' ? 45 : E.clock / 60;
    const frac = Math.max(0.02, (90 - min) / 90);
    const red = E.stats.map(s => s.red);
    const adj = (l, mine, theirs) => l * Math.pow(0.8, mine) * Math.pow(1.15, theirs);
    const odds = marketOdds(adj(lh, red[0], red[1]), adj(la, red[1], red[0]), E.score, frac);
    const open = (E.period === 'ht' || E.state === 'play') && min < 88;
    return { open, live: true, odds, score: E.score, label: E.period === 'ht' ? 'Mi-temps' : `${Math.floor(min) + 1}'`, suspended: !open };
  }

  // ---------- Coupon ----------
  toggle(m, market, pick, odd) {
    const i = this.slip.findIndex(s => s.key === m.key);
    if (i >= 0 && this.slip[i].market === market && this.slip[i].pick === pick) this.slip.splice(i, 1);
    else {
      const leg = { key: m.key, k: m.k, slot: m.slot, kickoff: m.kickoff, home: m.info.home.id, away: m.info.away.id, match: `${m.info.home.name} – ${m.info.away.name}`, market, pick, label: pickLabel(market, pick, m.info.home, m.info.away), odds: odd };
      if (i >= 0) this.slip[i] = leg; else this.slip.push(leg);
    }
    this.render();
  }

  totalOdds() { return Math.round(this.slip.reduce((a, l) => a * l.odds, 1) * 100) / 100; }

  place() {
    const stake = Math.floor(+this.stake * 100) / 100;
    const bal = this.w[this.currency];
    if (!this.slip.length) return this.msg('Choisis au moins une cote.');
    if (!(stake > 0)) return this.msg('Mise invalide.');
    if (stake > bal) return this.msg(`Pas assez de ${this.currency === 'jetons' ? 'jetons' : 'gains'} (solde : ${fmt(bal)}).`);
    // cotes revérifiées au moment de valider
    for (const leg of this.slip) {
      const m = this.matches.find(x => x.key === leg.key);
      const st = m && this.marketState(m);
      if (!st || !st.open) return this.msg(`Paris fermés pour ${leg.match}.`);
      const o = st.odds[leg.market]?.[leg.pick];
      if (!o) return this.msg(`Cote indisponible : ${leg.label}.`);
      leg.odds = o;
      leg.live = !!st.live;
      if (st.live) leg.scoreAt = [...st.score];
    }
    this.w[this.currency] -= stake;
    if (this.currency === 'jetons') this.w.stakedJ += stake; else this.w.stakedG += stake;
    const bet = { id: this.w.seq++, t: Date.now(), stake, currency: this.currency, legs: this.slip.map(l => ({ ...l })), odds: this.totalOdds(), status: 'open' };
    this.w.bets.unshift(bet);
    if (this.w.bets.length > 200) this.w.bets.length = 200;
    this.save();
    this.slip = [];
    this.msg(`Pari n°${bet.id} validé : ${fmt(stake)} ${this.currency === 'jetons' ? '🪙' : '🏆'} × ${bet.odds}`);
    this.app.toast?.(`🎟️ Pari validé · gain potentiel ${fmt(stake * bet.odds)} 🏆`);
    this.view = 'mes';
    this.render();
  }

  reload() {
    this.w.jetons += 1000; this.w.deposited += 1000; this.w.reloads++;
    this.save(); this.render();
    this.app.toast?.('🪙 +1 000 jetons ajoutés');
  }

  convertAll() {
    // option : remettre ses gains dans le porte-monnaie de jetons
    if (this.w.gains <= 0) return;
    this.w.jetons += this.w.gains; this.w.gains = 0; this.save(); this.render();
  }

  // ---------- Règlement des paris ----------
  async resultFor(leg) {
    const F = this.foot;
    if (F && F.slot === leg.slot && F.engine && F.info && F.k === leg.k) {
      const E = F.engine;
      if (E.period === 'end' || E.period === 'pens' || E.period === 'ft') return { score: E.score };
      return null;
    }
    const { season, item } = getSeason(leg.slot, leg.k, fullSim(leg.k));
    const s = footSlotAt(leg.kickoff, leg.k);
    const T = s.timing;
    const endEst = s.kickoff + (T.h2Offset + T.h2Max + 30) * 1000;
    if (this.app.now() < endEst) return null;
    const r = await season.result(item.comp, item.round, item.idx);
    return r ? { score: r.score } : null;
  }

  async settle() {
    if (this.settling) return;
    this.settling = true;
    let changed = false;
    try {
      for (const b of this.w.bets) {
        if (b.status !== 'open') continue;
        let allDone = true, lost = false;
        for (const leg of b.legs) {
          if (leg.result) continue;
          const r = await this.resultFor(leg);
          if (!r) { allDone = false; continue; }
          leg.final = r.score;
          leg.result = evaluate(leg.market, leg.pick, r.score) ? 'won' : 'lost';
          changed = true;
        }
        if (b.legs.some(l => l.result === 'lost')) lost = true;
        if (lost) { b.status = 'lost'; b.payout = 0; changed = true; this.app.toast?.(`❌ Pari n°${b.id} perdu (${fmt(b.stake)} ${b.currency === 'jetons' ? '🪙' : '🏆'})`); }
        else if (allDone) {
          b.status = 'won'; b.payout = Math.round(b.stake * b.odds * 100) / 100;
          this.w.gains += b.payout; this.w.won += b.payout; changed = true;
          this.app.toast?.(`🎉 Pari n°${b.id} gagné ! +${fmt(b.payout)} 🏆`);
        }
      }
    } catch (e) { console.warn('règlement', e); }
    this.settling = false;
    if (changed) { this.save(); this.render(); }
  }

  msg(t) { this.flash = t; this.render(); setTimeout(() => { if (this.flash === t) { this.flash = null; this.render(); } }, 3500); }

  // ---------- Interface ----------
  mount(container) {
    this.root = container;
    container.innerHTML = '';
    this.box = el('div', 'bet');
    container.appendChild(this.box);
    this.box.addEventListener('click', (e) => this.onClick(e));
    this.box.addEventListener('input', (e) => { if (e.target.name === 'stake') { this.stake = e.target.value; this.updateSlipNumbers(); } });
    this.render();
    if (Date.now() - this.lastList > 20000) this.refreshMatches().then(() => this.render());
  }

  tick() {
    if (!this.root || !this.root.isConnected || this.root.offsetParent === null) return;
    if (Date.now() - this.lastList > 60000) this.refreshMatches().then(() => this.render());
    // cotes en direct rafraîchies
    if (this.view === 'matchs' && Date.now() - (this.lastRender || 0) > 2500 && !this.box.contains(document.activeElement)) this.render();
  }

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'view') { this.view = t.dataset.v; this.render(); }
    if (a === 'odd') {
      const m = this.matches.find(x => x.key === t.dataset.key);
      if (m) this.toggle(m, t.dataset.m, t.dataset.p, +t.dataset.o);
    }
    if (a === 'expand') { this.expanded = this.expanded === t.dataset.key ? null : t.dataset.key; this.render(); }
    if (a === 'cur') { this.currency = t.dataset.v; this.render(); }
    if (a === 'quick') { this.stake = t.dataset.v === 'max' ? this.w[this.currency] : t.dataset.v; this.render(); }
    if (a === 'place') this.place();
    if (a === 'clear') { this.slip = []; this.render(); }
    if (a === 'rm') { this.slip.splice(+t.dataset.i, 1); this.render(); }
    if (a === 'reload') this.reload();
    if (a === 'convert') this.convertAll();
    if (a === 'watch') this.app.tune(0);
  }

  updateSlipNumbers() {
    const g = this.box.querySelector('.bs-pot');
    if (g) g.textContent = fmt((+this.stake || 0) * this.totalOdds());
  }

  render() {
    if (!this.box) return;
    this.lastRender = Date.now();
    const w = this.w;
    const sel = (key, m, p) => this.slip.some(s => s.key === key && s.market === m && s.pick === p);
    const head = `
      <div class="bt-wallet">
        <div class="bt-purse j"><small>🪙 Jetons (mise)</small><b>${fmt(w.jetons)}</b><button data-act="reload">+ Recharger</button></div>
        <div class="bt-purse g"><small>🏆 Gains</small><b>${fmt(w.gains)}</b><button data-act="view" data-v="bilan">Bilan</button></div>
      </div>
      <div class="bt-tabs">
        ${[['matchs', '⚽ Matchs'], ['mes', `🎟️ Mes paris${w.bets.filter(b => b.status === 'open').length ? ` (${w.bets.filter(b => b.status === 'open').length})` : ''}`], ['bilan', '📊 Bilan']].map(([v, l]) => `<button class="${this.view === v ? 'on' : ''}" data-act="view" data-v="${v}">${l}</button>`).join('')}
      </div>
      ${this.flash ? `<div class="bt-flash">${esc(this.flash)}</div>` : ''}`;
    let body = '';
    if (this.view === 'matchs') {
      if (!this.matches.length) body = '<div class="bt-empty">Chargement des matchs…</div>';
      for (const m of this.matches) {
        const st = this.marketState(m);
        const { home, away } = m.info;
        const o = st.odds;
        const btn = (mk, p, lbl) => {
          const v = o?.[mk]?.[p];
          if (!v) return `<button class="odd off" disabled>${lbl}<b>–</b></button>`;
          return `<button class="odd ${sel(m.key, mk, p) ? 'sel' : ''}" ${st.open ? '' : 'disabled'} data-act="odd" data-key="${m.key}" data-m="${mk}" data-p="${p}" data-o="${v}">${lbl}<b>${v.toFixed(2)}</b></button>`;
        };
        const exp = this.expanded === m.key;
        body += `<div class="bt-match ${st.live ? 'live' : ''}">
          <div class="bt-mh"><span class="bt-comp" style="background:${m.info.compColor}">${esc(m.info.compName)}</span><span class="bt-when">${st.live && !st.done ? '🔴 EN DIRECT · ' : ''}${esc(st.label)}</span></div>
          <div class="bt-teams">${teamBadge(home, 22)}<span class="tn">${esc(home.name)}</span>${st.score ? `<b class="bt-sc">${st.score[0]} - ${st.score[1]}</b>` : '<i>vs</i>'}<span class="tn r">${esc(away.name)}</span>${teamBadge(away, 22)}</div>
          ${st.done ? '<div class="bt-closed">Match terminé</div>' : !o ? `<div class="bt-closed">Paris fermés ${st.live ? '— regardez le match sur FOOT+' : ''}</div>` : `
          <div class="bt-row">${btn('1N2', '1', '1')}${btn('1N2', 'N', 'N')}${btn('1N2', '2', '2')}</div>
          ${st.suspended ? '<div class="bt-closed">⏸ Paris suspendus (action en cours)</div>' : ''}
          ${exp ? `
            <div class="bt-mk">${MARKET_LABEL.DC}</div><div class="bt-row">${btn('DC', '1N', '1N')}${btn('DC', '12', '12')}${btn('DC', 'N2', 'N2')}</div>
            <div class="bt-mk">${MARKET_LABEL.OU}</div><div class="bt-row">${btn('OU', 'O', '+2,5')}${btn('OU', 'U', '-2,5')}</div>
            <div class="bt-mk">${MARKET_LABEL.OU15}</div><div class="bt-row">${btn('OU15', 'O', '+1,5')}${btn('OU15', 'U', '-1,5')}</div>
            <div class="bt-mk">${MARKET_LABEL.BTTS}</div><div class="bt-row">${btn('BTTS', 'O', 'Oui')}${btn('BTTS', 'N', 'Non')}</div>
            <div class="bt-mk">${MARKET_LABEL.CS}</div><div class="bt-grid">${EXACT.map(s => btn('CS', s, s)).join('')}</div>` : ''}
          <button class="bt-more" data-act="expand" data-key="${m.key}">${exp ? 'Moins de paris ▲' : 'Plus de paris (buts, score exact…) ▼'}</button>`}
          ${st.live && !st.done ? '<button class="bt-watch" data-act="watch">📺 Regarder sur FOOT+</button>' : ''}
        </div>`;
      }
    } else if (this.view === 'mes') {
      if (!w.bets.length) body = '<div class="bt-empty">Aucun pari pour le moment.</div>';
      for (const b of w.bets.slice(0, 40)) {
        body += `<div class="bt-ticket ${b.status}">
          <div class="bt-th"><b>Pari n°${b.id}</b> · ${b.legs.length > 1 ? `Combiné ${b.legs.length} sélections` : 'Simple'}<span class="bt-st">${b.status === 'open' ? '⏳ En cours' : b.status === 'won' ? '✅ Gagné' : '❌ Perdu'}</span></div>
          ${b.legs.map(l => `<div class="bt-leg"><span>${esc(l.match)}</span><span>${esc(l.label)}${l.live ? ' <small>(direct)</small>' : ''}</span><b>${l.odds.toFixed(2)}</b>${l.final ? `<em class="${l.result}">${l.final[0]}-${l.final[1]}</em>` : ''}</div>`).join('')}
          <div class="bt-tf">Mise ${fmt(b.stake)} ${b.currency === 'jetons' ? '🪙' : '🏆'} · Cote ${b.odds.toFixed(2)} · ${b.status === 'won' ? `Gain <b>+${fmt(b.payout)} 🏆</b>` : `Gain potentiel ${fmt(b.stake * b.odds)} 🏆`}</div>
        </div>`;
      }
    } else {
      const staked = w.stakedJ + w.stakedG;
      const settled = w.bets.filter(b => b.status !== 'open');
      const wonN = settled.filter(b => b.status === 'won').length;
      const net = w.won - staked;
      const pct = (v, max) => Math.max(2, Math.min(100, (100 * v) / Math.max(1, max)));
      const max = Math.max(w.deposited, staked, w.won);
      body = `<div class="bt-bilan">
        <div class="bb-row"><span>🪙 Jetons rechargés</span><b>${fmt(w.deposited)}</b><i style="width:${pct(w.deposited, max)}%;background:#42a5f5"></i></div>
        <div class="bb-row"><span>📤 Total misé (jetons)</span><b>${fmt(w.stakedJ)}</b><i style="width:${pct(w.stakedJ, max)}%;background:#ef5350"></i></div>
        <div class="bb-row"><span>🔁 Gains rejoués</span><b>${fmt(w.stakedG)}</b><i style="width:${pct(w.stakedG, max)}%;background:#ffa726"></i></div>
        <div class="bb-row"><span>🏆 Total gagné</span><b>${fmt(w.won)}</b><i style="width:${pct(w.won, max)}%;background:#66bb6a"></i></div>
        <div class="bb-net ${net >= 0 ? 'pos' : 'neg'}">Bilan net : ${net >= 0 ? '+' : ''}${fmt(net)}<small>${net >= 0 ? 'Tu gagnes plus que tu ne mises 👏' : 'Tu as misé plus que tu n\'as gagné'}</small></div>
        <div class="bb-stats">${settled.length} pari(s) terminé(s) · ${wonN} gagné(s) · réussite ${settled.length ? Math.round((100 * wonN) / settled.length) : 0} %</div>
        <button class="bt-sec" data-act="convert">Transférer mes gains en jetons</button>
        <div class="bb-note">Argent 100 % fictif, sans valeur réelle. Les gains arrivent dans le porte-monnaie 🏆 et peuvent être rejoués.</div>
      </div>`;
    }
    // coupon
    let slip = '';
    if (this.slip.length) {
      const tot = this.totalOdds();
      slip = `<div class="bt-slip">
        <div class="bs-h"><b>🎟️ Coupon · ${this.slip.length > 1 ? `Combiné (${this.slip.length})` : 'Simple'}</b><button data-act="clear">Vider</button></div>
        ${this.slip.map((l, i) => `<div class="bs-leg"><span>${esc(l.match)}<small>${esc(l.label)}</small></span><b>${l.odds.toFixed(2)}</b><button data-act="rm" data-i="${i}">✕</button></div>`).join('')}
        <div class="bs-cur">Payer avec : <button class="${this.currency === 'jetons' ? 'on' : ''}" data-act="cur" data-v="jetons">🪙 Jetons (${fmt(w.jetons)})</button><button class="${this.currency === 'gains' ? 'on' : ''}" data-act="cur" data-v="gains">🏆 Gains (${fmt(w.gains)})</button></div>
        <div class="bs-stake"><input name="stake" type="number" inputmode="decimal" min="1" value="${esc(this.stake)}"/>${[5, 10, 50, 100].map(v => `<button data-act="quick" data-v="${v}">${v}</button>`).join('')}<button data-act="quick" data-v="max">Max</button></div>
        <div class="bs-sum">Cote totale <b>${tot.toFixed(2)}</b> · Gain potentiel <b class="bs-pot">${fmt((+this.stake || 0) * tot)}</b> 🏆</div>
        <button class="bs-go" data-act="place">Valider le pari</button>
      </div>`;
    }
    const scroll = this.box.querySelector('.bt-body')?.scrollTop || 0;
    this.box.innerHTML = head + `<div class="bt-body">${body}</div>` + slip;
    const nb = this.box.querySelector('.bt-body'); if (nb) nb.scrollTop = scroll;
  }
}
