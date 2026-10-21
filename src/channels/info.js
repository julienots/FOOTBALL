// Chaîne SPORT 24 INFO : journal des sports en continu (résultats, classements,
// buteurs, programme TV, scores en direct), présentatrice en voix de synthèse.
import { footSlotAt, getSeason, COMP } from '../data/season.js';
import { fullSim } from '../core/sim-service.js';
import { AdBreak, pickSpots } from '../tv/ads.js';
import { voice } from '../audio/voice.js';
import { el, esc, teamBadge } from '../tv/overlay.js';
import { NATIONS } from '../data/names.js';

const SEG = 40; // secondes par rubrique
const CYCLE = 600; // 10 minutes : 8 min d'info + 2 min de pub
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export class InfoChannel {
  constructor(app) {
    this.app = app;
    this.id = 'info'; this.name = 'SPORT 24 INFO'; this.color = '#d50000'; this.num = 3;
    this.box = el('div', 'news hidden');
    app.tvRoot.appendChild(this.box);
    this.ads = new AdBreak(app.tvRoot, 'SPORT 24');
    this.segIdx = -1;
    this.data = null;
  }

  async epg(now, count = 6) {
    const out = [];
    const base = Math.floor(now / (CYCLE * 1000)) * CYCLE * 1000;
    for (let i = 0; i < count; i++) out.push({ start: base + i * CYCLE * 1000, end: base + (i + 1) * CYCLE * 1000, title: 'Le journal des sports', sub: 'Résultats, classements, direct', live: i === 0 });
    return out;
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel('SPORT 24', this.color);
    this.box.classList.remove('hidden');
    this.app.canvasVisible(false);
    this.segIdx = -1;
    this.refresh();
  }

  leave() {
    this.visible = false;
    this.box.classList.add('hidden');
    this.ads.close();
    voice.stop();
    this.app.overlay.hideAll();
  }

  async refresh() {
    const k = this.app.settings.speed;
    const now = this.app.now();
    const s = footSlotAt(now, k);
    const { season, item } = getSeason(s.slot, k, fullSim(k));
    const n = item.n;
    const data = { season, n, k };
    try {
      data.table = await season.leagueTable(n, true);
      data.scorers = await season.topScorers(n, 8);
      const res = [];
      for (let j = n - 1; j >= 0 && res.length < 8; j--) {
        const it = season.items[j];
        const info = await season.matchInfo(it.comp, it.round, it.idx);
        const cached = season.results.get(info.key);
        if (cached) res.push({ info, res: cached, comp: it.comp });
        else if (!it.ko || true) { const r = await Promise.race([season.result(it.comp, it.round, it.idx), new Promise(r => setTimeout(() => r(null), 50))]); if (r) res.push({ info, res: r, comp: it.comp }); }
      }
      data.results = res;
      // dernière journée de championnat jouée (tous les matches)
      const done = season.playedRoundsBefore(n);
      const lastL = season.items.slice(0, n).reverse().find(x => x.comp === 'L' && done.has(`L|${x.round}`));
      if (lastL) data.round = { label: season.roundLabel('L', lastL.round), list: await season.roundResults('L', lastL.round).catch(() => []) };
      data.groups = [];
      for (let g = 0; g < 4; g++) data.groups.push(await season.groupTable(g, n).catch(() => null));
    } catch (e) { console.warn(e); }
    this.data = data;
  }

  update(dt, now) {
    if (!this.visible) return;
    this.app.hideLoader();
    const O = this.app.overlay;
    O.wallClock(new Date(now));
    const t = (now / 1000) % CYCLE;
    if (t > CYCLE - 120) {
      this.ads.update(t - (CYCLE - 120), pickSpots(Math.floor(now / (CYCLE * 1000)) * 3 + 5, 120), true);
      this.box.classList.add('hidden');
      O.hideAll();
      return;
    }
    this.ads.update(0, [], false);
    this.box.classList.remove('hidden');
    O.setLive('EN DIRECT');
    const seg = Math.floor(t / SEG);
    if (seg !== this.segIdx) {
      this.segIdx = seg;
      if (seg % 4 === 0) this.refresh();
      this.render(seg);
    }
    // scores en direct actualisés chaque seconde
    if (Math.floor(now / 1000) !== this._sec) {
      this._sec = Math.floor(now / 1000);
      const lv = this.box.querySelector('.nw-live');
      if (lv) lv.innerHTML = this.liveHtml();
    }
    O.setTicker(this.tickerItems());
  }

  liveHtml() {
    const rows = [];
    for (const ch of this.app.channels) {
      if (!ch.liveScore) continue;
      const l = ch.liveScore();
      if (!l) continue;
      rows.push(`<div class="nw-lv"><span class="nw-lvc">${esc(ch.name)}</span>${teamBadge(l.home, 22)} <b>${esc(l.home.name)}</b> <span class="nw-sc">${l.score[0]} - ${l.score[1]}</span> <b>${esc(l.away.name)}</b> ${teamBadge(l.away, 22)} <span class="nw-min">${esc(l.minute)}</span></div>`);
    }
    return rows.join('') || '<div class="nw-lv">Aucun match en cours</div>';
  }

  render(seg) {
    const d = this.data;
    const segments = ['live', 'results', 'table', 'scorers', 'nations', 'program', 'player', 'round'];
    const kind = segments[seg % segments.length];
    let title = '', body = '', speech = '';
    const now = this.app.now();
    if (kind === 'live' || !d) {
      title = 'En direct sur nos antennes';
      body = `<div class="nw-live">${this.liveHtml()}</div>`;
      const f = this.app.channels.find(c => c.id === 'foot')?.liveScore();
      speech = f ? `Bonsoir, voici l'essentiel de l'actualité sportive. En ce moment sur Foot plus, ${f.home.name} et ${f.away.name}, ${f.score[0]} à ${f.score[1]}.` : `Bonsoir et bienvenue dans le journal des sports.`;
    } else if (kind === 'results') {
      title = 'Les derniers résultats';
      const list = (d.results || []).slice(0, 8);
      body = `<div class="nw-res">${list.map(({ info, res, comp }) => `<div class="nw-r"><span class="nw-comp" style="background:${COMP[comp].color}">${esc(COMP[comp].short)}</span>${teamBadge(info.home, 22)}<span class="nw-t">${esc(info.home.name)}</span><span class="nw-sc">${res.score[0]} - ${res.score[1]}${res.pens ? ` <small>(tab ${res.pens[0]}-${res.pens[1]})</small>` : ''}</span><span class="nw-t r">${esc(info.away.name)}</span>${teamBadge(info.away, 22)}</div>`).join('') || '<div>Pas encore de résultats.</div>'}</div>`;
      const r = list[0];
      if (r) speech = `Dans le dernier match, ${r.info.home.name} ${r.res.score[0]}, ${r.info.away.name} ${r.res.score[1]}.`;
    } else if (kind === 'table' && d.table) {
      title = 'Ligue Élite · Classement';
      body = `<table class="tbl nw-tbl"><thead><tr><th>#</th><th class="tl">Équipe</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th><th>Pts</th><th>Forme</th></tr></thead><tbody>${d.table.map((r, i) => `<tr class="${i < 3 ? 'top' : i >= 14 ? 'bot' : ''}"><td>${i + 1}</td><td class="tl">${teamBadge(r.team, 18)} ${esc(r.team.name)}</td><td>${r.j}</td><td>${r.g}</td><td>${r.n}</td><td>${r.p}</td><td>${r.bp - r.bc}</td><td><b>${r.pts}</b></td><td>${(r.form || []).slice(-5).map(f => `<i class="fm ${f}">${f}</i>`).join('')}</td></tr>`).join('')}</tbody></table>`;
      const L = d.table[0];
      speech = L.j ? `En Ligue Élite, ${L.team.name} est en tête avec ${L.pts} points après ${L.j} journées, devant ${d.table[1].team.name}.` : `La saison de Ligue Élite vient de commencer.`;
    } else if (kind === 'scorers' && d.scorers) {
      title = 'Meilleurs buteurs';
      body = `<div class="nw-sco">${d.scorers.map((x, i) => `<div class="nw-s"><span class="nw-rank">${i + 1}</span><span class="nw-flag" style="background:linear-gradient(90deg,${NATIONS[x.player.nation].flag.join(',')})"></span><b>${esc(x.player.name)}</b><small>${esc(this.app.world.teams[x.player.teamId].name)}</small><span class="nw-g">${x.goals}</span></div>`).join('') || 'Aucun but pour le moment.'}</div>`;
      if (d.scorers[0]) speech = `Au classement des buteurs, ${d.scorers[0].player.name} mène la danse avec ${d.scorers[0].goals} buts.`;
    } else if (kind === 'nations' && d.groups) {
      title = 'Coupe des Nations · Groupes';
      body = `<div class="nw-groups">${d.groups.map((g, gi) => g ? `<div class="nw-grp"><div class="nw-gh">Groupe ${'ABCD'[gi]}</div>${g.map(r => `<div class="nw-gr">${teamBadge(r.team, 18)} ${esc(r.team.name)} <b>${r.pts}</b></div>`).join('')}</div>` : '').join('')}</div>`;
      speech = 'Place à la Coupe des Nations et aux classements des groupes.';
    } else if (kind === 'program') {
      title = 'Ce soir sur vos chaînes';
      body = '<div class="nw-prog">Chargement…</div>';
      Promise.all(this.app.channels.filter(c => c.id !== 'info').map(async c => ({ c, list: await c.epg(now, 3) }))).then(all => {
        const p = this.box.querySelector('.nw-prog');
        if (p) p.innerHTML = all.map(({ c, list }) => `<div class="nw-pc"><div class="nw-pch" style="background:${c.color}">${c.num} · ${esc(c.name)}</div>${list.map(e => `<div class="nw-pe"><b>${fmtTime(e.start)}</b> ${esc(e.title)} <small>${esc(e.sub)}</small></div>`).join('')}</div>`).join('');
      });
      speech = 'Voici le programme de vos chaînes de sport.';
    } else if (kind === 'player') {
      const pool = d.scorers?.length ? d.scorers.map(x => x.player) : Object.values(this.app.world.players).filter(p => p.star);
      const p = pool[seg % pool.length];
      if (p) {
        title = 'Le joueur à suivre';
        const team = this.app.world.teams[p.teamId];
        const bar = (l, v) => `<div class="nw-at"><span>${l}</span><div><i style="width:${v}%"></i></div><b>${v}</b></div>`;
        body = `<div class="nw-player"><div class="nw-pcard" style="--tc:${team.colors[0]}"><div class="nw-pnum">${p.number}</div><div class="nw-pname">${esc(p.name)}</div><div class="nw-pinfo">${esc(team.name)} · ${p.age} ans · ${esc(NATIONS[p.nation].name)}</div><div class="nw-povr">${p.ovr}</div></div>
          <div class="nw-attrs">${bar('Vitesse', p.attrs.pac)}${bar('Tir', p.attrs.sho)}${bar('Passe', p.attrs.pas)}${bar('Dribble', p.attrs.dri)}${bar('Défense', p.attrs.def)}${bar('Physique', p.attrs.phy)}</div></div>`;
        speech = `Le joueur à suivre : ${p.name}, ${p.age} ans, de ${team.name}. Une note générale de ${p.ovr}.`;
      }
    } else if (kind === 'round' && d.round) {
      title = `Ligue Élite · ${d.round.label}`;
      body = `<div class="nw-res">${d.round.list.map(({ info, res }) => `<div class="nw-r">${teamBadge(info.home, 22)}<span class="nw-t">${esc(info.home.name)}</span><span class="nw-sc">${res.score[0]} - ${res.score[1]}</span><span class="nw-t r">${esc(info.away.name)}</span>${teamBadge(info.away, 22)}</div>`).join('')}</div>`;
      speech = `Retour sur la ${d.round.label} de Ligue Élite.`;
    }
    if (!body) { title = 'En direct sur nos antennes'; body = `<div class="nw-live">${this.liveHtml()}</div>`; }
    this.box.innerHTML = `
      <div class="nw-bg"></div>
      <div class="nw-studio"><div class="nw-anchor"><div class="nw-ava">CA</div><div><b>Claire Aubert</b><small>Présentatrice</small></div></div><div class="nw-logo">SPORT<span>24</span>INFO</div></div>
      <div class="nw-panel"><div class="nw-title">${esc(title)}</div><div class="nw-body">${body}</div></div>`;
    if (speech) voice.say('anchor', speech, 1, { channel: 'info', ttl: 30000 });
  }

  tickerItems() {
    const items = ['SPORT 24 INFO · Toute l\'actualité du sport en continu'];
    for (const ch of this.app.channels) {
      const l = ch.liveScore?.();
      if (l) items.push(`${ch.name} EN DIRECT : ${l.home.name} ${l.score[0]}-${l.score[1]} ${l.away.name} (${l.minute})`);
    }
    if (this.data?.table?.[0]?.j) items.push(`Ligue Élite : ${this.data.table[0].team.name} leader avec ${this.data.table[0].pts} points`);
    return items;
  }
}
