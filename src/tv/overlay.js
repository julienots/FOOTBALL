// Habillage TV : bandeau de score, logo de chaîne, bannières (but, carton,
// remplacement), compositions, statistiques, classements, bandeau défilant.

export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function teamBadge(team, size = 34) {
  const c1 = team.colors[0], c2 = team.colors[1];
  if (team.flag) {
    const [a, b, c] = team.flag;
    return `<span class="badge flag" style="width:${size}px;height:${size * 0.68}px;background:linear-gradient(90deg,${a} 0 33%,${b} 33% 66%,${c} 66%)"></span>`;
  }
  return `<span class="badge crest" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${c1} 0 50%,${c2} 50%);"><b style="color:${lum(c1) > 0.6 ? '#111' : '#fff'}">${esc(team.short[0])}</b></span>`;
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export class Overlay {
  constructor(root) {
    this.root = root;
    this.layer = el('div', 'ov');
    root.appendChild(this.layer);
    this.bug = el('div', 'scorebug hidden');
    this.logo = el('div', 'chan-logo');
    this.clockEl = el('div', 'wallclock');
    this.live = el('div', 'live-pill hidden', 'EN DIRECT');
    this.ticker = el('div', 'ticker hidden', '<div class="tk-label">INFO</div><div class="tk-track"><div class="tk-text"></div></div>');
    this.banner = el('div', 'banner hidden');
    this.panel = el('div', 'panel hidden');
    this.replayTag = el('div', 'replay-tag hidden', '<span class="rp-dot"></span> RALENTI');
    this.carrier = el('div', 'carrier hidden');
    this.center = el('div', 'center-msg hidden');
    this.goalFx = el('div', 'goalfx hidden');
    for (const e of [this.bug, this.logo, this.live, this.clockEl, this.ticker, this.banner, this.panel, this.replayTag, this.carrier, this.center, this.goalFx]) this.layer.appendChild(e);
    this.bannerTimer = null;
    this.tickerItems = [];
  }

  setChannel(name, color) {
    this.logo.innerHTML = `<span class="cl-name">${name}</span><span class="cl-hd">HD</span>`;
    this.logo.style.setProperty('--cc', color);
  }

  setLive(text) {
    if (!text) { this.live.classList.add('hidden'); return; }
    this.live.textContent = text;
    this.live.classList.remove('hidden');
  }

  wallClock(date) {
    // appelée à chaque image : on ne reformate (et ne touche au DOM) qu'au changement de minute
    const m = Math.floor(date.getTime() / 60000);
    if (m === this.clockMin) return;
    this.clockMin = m;
    this.clockEl.textContent = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Bandeau de score ----------
  scorebug(s) {
    if (!s) { this.bug.classList.add('hidden'); return; }
    const key = `${s.home.id}${s.away.id}${s.comp}`;
    if (this.bugKey !== key) {
      this.bugKey = key;
      this.bug.innerHTML = `
        <div class="sb-comp" style="background:${s.compColor}">${esc(s.comp)}</div>
        <div class="sb-main">
          <div class="sb-team"><i style="background:${s.homeColor}"></i><span>${esc(s.home.short)}</span></div>
          <div class="sb-score"><span class="sb-h">0</span><span class="sb-sep">-</span><span class="sb-a">0</span></div>
          <div class="sb-team"><span>${esc(s.away.short)}</span><i style="background:${s.awayColor}"></i></div>
          <div class="sb-clock">00:00</div>
          <div class="sb-add hidden">+0</div>
        </div>
        <div class="sb-extra hidden"></div>`;
      this.sbH = this.bug.querySelector('.sb-h'); this.sbA = this.bug.querySelector('.sb-a');
      this.sbClock = this.bug.querySelector('.sb-clock'); this.sbAdd = this.bug.querySelector('.sb-add');
      this.sbExtra = this.bug.querySelector('.sb-extra');
    }
    this.bug.classList.remove('hidden');
    if (this.sbH.textContent !== String(s.score[0])) { this.sbH.textContent = s.score[0]; flash(this.sbH); }
    if (this.sbA.textContent !== String(s.score[1])) { this.sbA.textContent = s.score[1]; flash(this.sbA); }
    this.sbClock.textContent = s.clock;
    if (s.added) { this.sbAdd.textContent = '+' + s.added; this.sbAdd.classList.remove('hidden'); } else this.sbAdd.classList.add('hidden');
    if (s.extra) { this.sbExtra.innerHTML = s.extra; this.sbExtra.classList.remove('hidden'); } else this.sbExtra.classList.add('hidden');
    if (s.cards) {
      // cartons rouges
    }
  }

  // ---------- Bannières ----------
  showBanner(html, ms = 5000, cls = '') {
    this.banner.className = 'banner ' + cls;
    this.banner.innerHTML = html;
    void this.banner.offsetWidth;
    this.banner.classList.add('in');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.hideBanner(), ms);
  }
  hideBanner() { this.banner.classList.remove('in'); setTimeout(() => { if (!this.banner.classList.contains('in')) this.banner.className = 'banner hidden'; }, 400); }

  goal(team, rec, score, other) {
    this.goalFx.innerHTML = `<div class="gf-band" style="--tc:${team.colors[0]};--tc2:${team.colors[1]}"><div class="gf-word">BUT !</div><div class="gf-team">${teamBadge(team, 46)} ${esc(team.name)}</div></div>`;
    this.goalFx.className = 'goalfx';
    void this.goalFx.offsetWidth;
    this.goalFx.classList.add('in');
    setTimeout(() => this.goalFx.classList.add('out'), 3800);
    setTimeout(() => { this.goalFx.className = 'goalfx hidden'; }, 4500);
    setTimeout(() => {
      const who = rec.ownGoal ? `${esc(rec.fullName)} <small>(c.s.c.)</small>` : esc(rec.fullName);
      this.showBanner(`<div class="bn-row"><span class="bn-ico">⚽</span><div><div class="bn-title">${who} <b>${rec.minute}'</b></div><div class="bn-sub">${esc(team.name)}${rec.assist ? ' · passe décisive ' + esc(rec.assist) : ''}${rec.pen ? ' · penalty' : ''}</div></div><div class="bn-score">${score[0]} - ${score[1]}</div></div>`, 7000, 'goal');
    }, 4300);
  }

  card(team, ev) {
    const c = ev.card === 'yellow' ? 'yellow' : 'red';
    this.showBanner(`<div class="bn-row"><span class="card-ico ${c}"></span><div><div class="bn-title">${esc(ev.fullName)}</div><div class="bn-sub">${esc(team.name)} · ${c === 'yellow' ? 'Carton jaune' : ev.card === 'red2' ? 'Deuxième avertissement · Expulsion' : 'Carton rouge · Expulsion'}</div></div></div>`, 5000);
  }

  sub(team, ev) {
    this.showBanner(`<div class="bn-row"><span class="bn-ico">🔄</span><div><div class="bn-title"><span class="in">▲ ${esc(ev.inFull)}</span></div><div class="bn-title"><span class="out">▼ ${esc(ev.outFull)}</span></div></div><div class="bn-team">${teamBadge(team, 30)}</div></div>`, 6000, 'sub');
  }

  info(text, ms = 4000) {
    this.showBanner(`<div class="bn-row"><div class="bn-title">${text}</div></div>`, ms, 'info');
  }

  // ---------- Panneaux plein écran ----------
  showPanel(html, cls = '') {
    this.panel.className = 'panel ' + cls;
    this.panel.innerHTML = html;
    void this.panel.offsetWidth;
    this.panel.classList.add('in');
  }
  hidePanel() { this.panel.className = 'panel hidden'; this.panelKey = null; }

  lineups(home, away, homeData, awayData, title) {
    const col = (t, d) => `
      <div class="lu-col">
        <div class="lu-head" style="--tc:${t.colors[0]}">${teamBadge(t, 40)}<div><div class="lu-name">${esc(t.name)}</div><div class="lu-form">${esc(t.formation)} · Entraîneur : ${esc(t.coach)}</div></div></div>
        <ol class="lu-list">${t.squad.slice(0, 11).map(p => `<li><b>${p.number}</b> ${esc(p.name)} <small>${p.role}</small>${p.star ? ' <em>★</em>' : ''}</li>`).join('')}</ol>
        <div class="lu-bench">Remplaçants : ${t.squad.slice(11).map(p => esc(p.short)).join(', ')}</div>
      </div>`;
    this.showPanel(`<div class="pn-title">${esc(title || 'Compositions officielles')}</div><div class="lu">${col(home, homeData)}${col(away, awayData)}</div>`, 'lineups');
  }

  stats(title, match, home, away) {
    const st = match.stats;
    const tot = st[0].poss + st[1].poss || 1;
    const rows = [
      ['Possession', Math.round((100 * st[0].poss) / tot) + '%', Math.round((100 * st[1].poss) / tot) + '%', st[0].poss / tot],
      ['Tirs', st[0].shots, st[1].shots],
      ['Tirs cadrés', st[0].onTarget, st[1].onTarget],
      ['Buts attendus (xG)', st[0].xg.toFixed(2), st[1].xg.toFixed(2)],
      ['Passes réussies', `${st[0].passOk}/${st[0].passes}`, `${st[1].passOk}/${st[1].passes}`, (st[0].passOk || 1) / ((st[0].passOk + st[1].passOk) || 2)],
      ['Corners', st[0].corners, st[1].corners],
      ['Fautes', st[0].fouls, st[1].fouls],
      ['Hors-jeu', st[0].offsides, st[1].offsides],
      ['Cartons jaunes', st[0].yellow, st[1].yellow],
      ['Cartons rouges', st[0].red, st[1].red],
      ['Arrêts', st[0].saves, st[1].saves],
    ];
    const goals = match.goalsLog.map(g => `<div class="st-goal ${g.team ? 'r' : 'l'}">⚽ ${esc(g.name)} ${g.minute}'${g.ownGoal ? ' (csc)' : ''}${g.pen ? ' (pen.)' : ''}</div>`).join('');
    this.showPanel(`
      <div class="pn-title">${esc(title)}</div>
      <div class="st-head">${teamBadge(home, 44)}<span class="st-team">${esc(home.name)}</span><span class="st-score">${match.score[0]} - ${match.score[1]}</span><span class="st-team">${esc(away.name)}</span>${teamBadge(away, 44)}</div>
      ${match.pens ? `<div class="st-pens">Tirs au but : ${match.pens.score[0]} - ${match.pens.score[1]}</div>` : ''}
      <div class="st-goals">${goals}</div>
      <div class="st-rows">${rows.map(([l, a, b, f]) => {
        const fa = f ?? (Number(a) + Number(b) ? Number(a) / (Number(a) + Number(b)) : 0.5);
        return `<div class="st-row"><span class="st-a">${a}</span><div class="st-mid"><div class="st-l">${l}</div><div class="st-bar"><i style="width:${(fa * 100).toFixed(0)}%;background:${home.colors[0]}"></i><i style="width:${(100 - fa * 100).toFixed(0)}%;background:${away.colors[0]}"></i></div></div><span class="st-b">${b}</span></div>`;
      }).join('')}</div>`, 'stats');
  }

  table(title, rows, highlight = []) {
    this.showPanel(`<div class="pn-title">${esc(title)}</div>
      <table class="tbl"><thead><tr><th>#</th><th class="tl">Équipe</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th><th>Pts</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${highlight.includes(r.id) ? 'hl' : ''} ${i < 3 ? 'top' : i >= rows.length - 2 ? 'bot' : ''}"><td>${i + 1}</td><td class="tl">${teamBadge(r.team, 18)} ${esc(r.team.name)}</td><td>${r.j}</td><td>${r.g}</td><td>${r.n}</td><td>${r.p}</td><td>${r.bp - r.bc > 0 ? '+' : ''}${r.bp - r.bc}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody></table>`, 'table');
  }

  matchCard(title, info, sub) {
    this.showPanel(`<div class="pn-title">${esc(title)}</div>
      <div class="mc">
        <div class="mc-team">${teamBadge(info.home, 90)}<div>${esc(info.home.name)}</div></div>
        <div class="mc-vs"><div class="mc-comp">${esc(info.compName)}</div><div class="mc-round">${esc(info.roundLabel)}</div><div class="mc-big">VS</div><div class="mc-sub">${sub || ''}</div></div>
        <div class="mc-team">${teamBadge(info.away, 90)}<div>${esc(info.away.name)}</div></div>
      </div>`, 'matchcard');
  }

  // ---------- Divers ----------
  setTicker(items) {
    if (!items || !items.length) { this.ticker.classList.add('hidden'); return; }
    const txt = items.map(esc).join('<span class="tk-sep">◆</span>');
    if (txt !== this.tickerTxt) {
      this.tickerTxt = txt;
      const t = this.ticker.querySelector('.tk-text');
      t.innerHTML = txt;
      t.style.animationDuration = Math.max(25, items.join(' ').length * 0.22) + 's';
    }
    this.ticker.classList.remove('hidden');
  }

  replay(on) { this.replayTag.classList.toggle('hidden', !on); }

  setCarrier(p, teamColor) {
    if (!p) { this.carrier.classList.add('hidden'); return; }
    const key = p.data.id;
    if (this.carrierKey !== key) {
      this.carrierKey = key;
      this.carrier.innerHTML = `<i style="background:${teamColor}"></i><b>${p.data.number}</b> ${esc(p.data.short.toUpperCase())}`;
    }
    this.carrier.classList.remove('hidden');
  }

  centerMsg(html) {
    if (!html) { this.center.classList.add('hidden'); return; }
    this.center.innerHTML = html;
    this.center.classList.remove('hidden');
  }

  hideAll() {
    this.scorebug(null); this.hidePanel(); this.replay(false); this.setCarrier(null); this.centerMsg(null); this.setLive(null);
    this.banner.className = 'banner hidden'; this.goalFx.className = 'goalfx hidden';
  }
}

function flash(e) { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); }
