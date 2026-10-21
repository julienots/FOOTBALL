// Commentaires en direct : deux commentateurs (le "play-by-play" et le
// consultant) réagissent aux actions, se répondent et meublent les temps morts.
import { voice } from '../audio/voice.js';
import { NATIONS } from '../data/names.js';
import { ROLE_LABEL } from '../data/world.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;
const nb = (n) => ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'][n] ?? String(n);
const score = (s) => `${nb(s[0])} à ${nb(s[1])}`;

export class Commentary {
  constructor(engine, ctx) {
    this.m = engine;
    this.ctx = ctx; // { home, away, comp, roundLabel, stadium, night, ranks, seasonGoals }
    this.silence = 0;
    this.lastPassCall = 0;
    this.lastLineAt = 0;
    this.mentioned = new Set();
    this.pendingShot = null;
    this.ch = 'foot';
    this.unsub = voice.onSpeak(() => { this.silence = 0; });
  }

  dispose() { this.unsub(); voice.clear(this.ch); }

  team(t) { return this.m.teams[t].data; }
  tname(t) { return this.team(t).name; }
  say(who, text, prio = 1, ttl) { voice.say(who, text, prio, { channel: this.ch, ttl }); this.silence = 0; }
  pbp(text, prio = 2, ttl) { this.say('pbp', text, prio, ttl); }
  cons(text, prio = 1, ttl) { this.say('cons', text, prio, ttl); }
  player(id) { return this.ctx.players?.[id]; }

  // ---------- Avant-match ----------
  intro() {
    const { home, away, comp, roundLabel, stadium, night } = this.ctx;
    const hello = night ? 'Bonsoir' : 'Bonjour';
    this.pbp(`${hello} à toutes et à tous, et bienvenue au ${stadium} pour ce match de ${comp}, ${roundLabel}, entre ${home.name} et ${away.name}.`, 1, 60000);
    this.cons(pick([
      `Bonjour Jean-Marc. Une très belle affiche, ${home.name} devant son public, face à une équipe de ${away.name} qui arrive avec beaucoup d'ambitions.`,
      `Oui Jean-Marc, on attend ce match depuis longtemps. Deux styles différents, ça promet.`,
      `Salut Jean-Marc. Le stade est plein, l'ambiance est déjà électrique, on va se régaler.`,
    ]), 1, 60000);
    const hr = this.ctx.ranks?.[home.id], ar = this.ctx.ranks?.[away.id];
    if (hr && ar) this.pbp(`Au classement, ${home.name} est ${ordinal(hr)}, ${away.name} ${ordinal(ar)}.`, 1, 60000);
    this.cons(`${home.name} se présente en ${home.formation}, avec un jeu basé sur ${styleText(home.style)}. En face, ${away.name} en ${away.formation}.`, 1, 60000);
  }

  // ---------- Événements du moteur ----------
  handle(ev) {
    const m = this.m;
    const T = ev.team;
    switch (ev.type) {
      case 'kickoff':
        if (ev.half === 1) this.pbp(pick(["Coup d'envoi donné ! C'est parti !", "L'arbitre siffle le coup d'envoi, c'est parti pour quatre-vingt-dix minutes !", "Et c'est parti ! Premier ballon pour " + this.tname(T) + '.']), 2);
        else this.pbp(pick(["C'est reparti pour la seconde période !", 'Le second acte est lancé !', "Coup d'envoi de la deuxième mi-temps !"]), 2);
        break;
      case 'pass':
        if (performance.now() - this.lastPassCall > 4500 && !voice.busy() && chance(ev.through || ev.long ? 0.7 : 0.25)) {
          this.lastPassCall = performance.now();
          if (ev.through) this.pbp(pick([`Ballon en profondeur pour ${ev.toName} !`, `${ev.fromName} lance ${ev.toName} !`, `Belle ouverture de ${ev.fromName} !`]), 2, 2500);
          else if (ev.long) this.pbp(pick([`Longue transversale de ${ev.fromName}.`, `${ev.fromName} renverse le jeu vers ${ev.toName}.`, `Jeu long de ${ev.fromName}.`]), 1, 2500);
          else this.pbp(pick([`${ev.fromName}... pour ${ev.toName}.`, `${ev.fromName}, ${ev.toName}.`, `${ev.toName}.`, `${ev.fromName} temporise.`, `Ça circule bien chez ${this.tname(T)}.`]), 1, 2000);
        }
        break;
      case 'cross':
        if (!voice.busy() || chance(0.3)) this.pbp(pick([`Centre de ${ev.fromName} !`, `${ev.fromName} centre !`, `Le centre de ${ev.fromName}...`]), 2, 2000);
        break;
      case 'dribble':
        if (!voice.busy() && chance(0.5)) this.pbp(pick([`Joli crochet de ${ev.name} !`, `${ev.name} élimine ${ev.victim} !`, `Quelle feinte de ${ev.name} !`, `${ev.name} fait la différence !`]), 2, 2500);
        break;
      case 'tackle':
        if (!voice.busy() && chance(0.35)) this.pbp(pick([`Bon tacle de ${ev.name}.`, `${ev.name} récupère le ballon.`, `Intervention parfaite de ${ev.name} !`]), 1, 2500);
        break;
      case 'intercept':
        if (!voice.busy() && chance(0.15)) this.pbp(pick([`Interception de ${ev.name}.`, `${ev.name} coupe la trajectoire.`]), 1, 2000);
        break;
      case 'shot': {
        const kind = ev.header ? pick([`Tête de ${ev.name} !`, `${ev.name} de la tête !`]) :
          ev.kind === 'fk' ? `${ev.name} tente sa chance directement !` :
          ev.kind === 'pen' ? `${ev.name} s'élance...` :
          ev.dist > 22 ? pick([`${ev.name} tente de loin !`, `Frappe lointaine de ${ev.name} !`, `${ev.name} arme sa frappe !`]) :
          pick([`Frappe de ${ev.name} !`, `${ev.name} tire !`, `${ev.name}, la frappe !`, `${ev.name} déclenche !`]);
        this.pbp(kind, 3, 3000);
        this.pendingShot = ev;
        break;
      }
      case 'save':
        this.pbp(ev.caught ? pick([`Bien capté par ${ev.name}.`, `${ev.name} s'en saisit.`, `Sans problème pour ${ev.name}.`]) :
          pick([`Arrêt de ${ev.name} !`, `Quelle parade de ${ev.name} !`, `${ev.name} détourne !`, `Superbe arrêt de ${ev.name} !`]), 2, 3500);
        if (!ev.caught && chance(0.5)) this.cons(pick([`Très bon réflexe du gardien.`, `Il a fait l'essentiel, ${ev.name}.`, `C'est un arrêt décisif, ça.`]), 1, 7000);
        break;
      case 'miss':
        this.pbp(ev.wide ? pick(["C'est à côté !", 'Le ballon passe à côté du poteau !', 'Non, ça file à côté !', 'Pas cadré !']) : pick(['Au-dessus !', 'Trop haut !', 'Ça passe au-dessus de la barre !']), 2, 3000);
        if (ev.xg > 0.25 && chance(0.8)) this.cons(pick([`Oh, il devait mieux faire là, ${ev.name}.`, `Quelle occasion manquée !`, `Il aura des regrets, ${ev.name}.`, `C'était l'occasion rêvée...`]), 2, 7000);
        break;
      case 'block':
        this.pbp(pick([`Contré par ${ev.name} !`, `${ev.name} se jette et contre !`, `Le tir est contré !`]), 2, 3000);
        break;
      case 'post':
        this.pbp(ev.bar ? pick(['Sur la barre !!', 'La transversale !', 'Oh, la barre transversale !']) : pick(['Sur le poteau !!', 'Le poteau !', 'Ohhh le montant !']), 3, 3500);
        this.cons(pick(["Ça s'est joué à quelques centimètres !", 'Pas de chance !', "Le poteau sauve le gardien !"]), 2, 7000);
        break;
      case 'goal': {
        const scorerTeam = this.tname(ev.team);
        const shout = ev.ownGoal ? `BUUUT ! Contre son camp ! ${ev.name} trompe son propre gardien !` :
          pick([`BUUUUUT ! ${ev.name} ! ${ev.name} !`, `BUUUUT ! ${ev.name} marque pour ${scorerTeam} !`, `IL MARQUE ! ${ev.name} ! QUEL BUT !`, `GOOOAL ! ${ev.name} fait trembler les filets !`]);
        this.pbp(shout, 3, 8000);
        const s = ev.score;
        const lead = s[0] === s[1] ? `Égalisation ! ${score(s)}.` : `${this.tname(s[0] > s[1] ? 0 : 1)} mène ${score(s[0] > s[1] ? s : [s[1], s[0]])}.`;
        this.pbp(`${lead} À la ${ev.minute}e minute.`, 3, 12000);
        if (ev.assist && !ev.ownGoal) this.cons(pick([`Superbe passe de ${ev.assist}, il le met dans des conditions idéales.`, `Et quel caviar de ${ev.assist} !`, `Il faut saluer la passe décisive de ${ev.assist}.`]), 2, 15000);
        else if (ev.pen) this.cons(pick(['Penalty parfaitement tiré, le gardien part du mauvais côté.', 'Aucune chance pour le gardien, c\'est imparable.']), 2, 15000);
        else if (ev.header) this.cons(pick(['Un coup de tête superbe, il prend le dessus sur son défenseur.', 'Quelle détente ! Une tête puissante, imparable.']), 2, 15000);
        else if (ev.dist > 20) this.cons(pick(['Une frappe de mule ! Le gardien n\'a rien pu faire.', 'Quel missile ! Une frappe lointaine magnifique.']), 2, 15000);
        else this.cons(pick(['Il a été très froid devant le but.', 'Le geste du buteur, tout simplement.', 'La défense a été prise de vitesse sur cette action.', `Ça fait du bien à ${scorerTeam}, ce but.`]), 2, 15000);
        const g = this.ctx.seasonGoals?.[ev.scorer];
        if (g && !ev.ownGoal) this.pbp(`C'est son ${ordinal(g + 1, true)} but de la saison.`, 1, 20000);
        break;
      }
      case 'foul':
        if (ev.inBox) break;
        if (!voice.busy() || chance(0.4)) this.pbp(pick([`Faute de ${ev.name} sur ${ev.victim}.`, `${ev.name} commet la faute.`, `Coup de sifflet, faute de ${ev.name}.`, `${ev.victim} est accroché par ${ev.name}.`]), 2, 3000);
        break;
      case 'card':
        if (ev.card === 'yellow') {
          this.pbp(pick([`Carton jaune pour ${ev.name}.`, `L'arbitre sort le jaune, ${ev.name} est averti.`, `${ev.name} prend un carton jaune.`]), 2, 5000);
          if (chance(0.6)) this.cons(pick(['Il arrive en retard, c\'est logique.', 'Il devra faire attention maintenant.', 'Carton mérité, c\'était un tacle imprudent.', 'Un peu sévère, mais ça se discute.']), 1, 9000);
        } else {
          this.pbp(ev.card === 'red2' ? `Deuxième carton jaune pour ${ev.name}, et donc rouge ! Il est expulsé !` : `CARTON ROUGE ! ${ev.name} est expulsé !`, 3, 6000);
          this.cons(pick([`${this.tname(T)} va devoir finir à dix, ça change tout.`, 'Quel coup dur pour son équipe !', 'Geste totalement inutile, il pénalise ses coéquipiers.']), 2, 12000);
        }
        break;
      case 'penalty':
        this.pbp(pick([`PENALTY ! L'arbitre désigne le point de penalty !`, `Penalty pour ${this.tname(T)} !`]), 3, 5000);
        this.cons(pick(['Il n\'y a pas de doute, il est fauché dans la surface.', 'Penalty logique, il fait tomber l\'attaquant.', 'C\'est un peu léger, mais l\'arbitre est bien placé.']), 2, 12000);
        this.pbp(`C'est ${ev.taker} qui va le tirer.`, 2, 20000);
        break;
      case 'restart':
        if (ev.rtype === 'free' && ev.dangerous) this.pbp(pick([`Coup franc dangereux pour ${this.tname(T)}.`, `Coup franc idéalement placé pour ${this.tname(T)}, ${ev.taker} se prépare.`]), 2, 6000);
        else if (ev.rtype === 'goalkick' && !voice.busy() && chance(0.2)) this.pbp(pick(['Six mètres.', 'Dégagement aux six mètres.']), 1, 2500);
        break;
      case 'corner':
        if (!voice.busy() || chance(0.5)) this.pbp(pick([`Corner pour ${this.tname(T)}.`, `Corner, tiré par ${ev.taker}.`, `${this.tname(T)} obtient un corner.`]), 2, 4000);
        break;
      case 'offside':
        this.pbp(pick([`${ev.name} est signalé hors-jeu.`, `Hors-jeu de ${ev.name}, le drapeau se lève.`, `Le juge de touche signale un hors-jeu.`]), 2, 4000);
        break;
      case 'sub':
        this.pbp(`Changement côté ${this.tname(T)} : ${ev.out} cède sa place à ${ev.in}.`, 2, 15000);
        if (chance(0.6)) this.cons(pick([`Du sang neuf pour ${this.tname(T)}.`, `L'entraîneur veut changer quelque chose.`, `${ev.out} a beaucoup couru, c'est logique.`]), 1, 15000);
        break;
      case 'stoppage':
        this.pbp(`Le quatrième arbitre annonce ${nb(ev.minutes)} minute${ev.minutes > 1 ? 's' : ''} de temps additionnel.`, 2, 15000);
        break;
      case 'halftime':
        this.halftime(ev);
        break;
      case 'fulltime':
        this.fulltime(ev);
        break;
      case 'pens_start':
        this.pbp('Égalité à la fin du temps réglementaire, on va donc aux tirs au but !', 3, 20000);
        this.cons('La loterie des tirs au but... Les nerfs vont parler.', 2, 20000);
        break;
      case 'pen_kick':
        this.pbp(ev.result === 'goal' ? pick([`${ev.name} marque !`, `Réussi pour ${ev.name} !`, `Transformé !`]) : ev.result === 'saved' ? pick([`Arrêté ! Le gardien a deviné !`, `Raté ! Arrêt du gardien !`]) : pick([`À côté ! ${ev.name} manque son tir au but !`, `Il manque le cadre !`]), 3, 8000);
        this.pbp(`${nb(ev.pens[0])} à ${nb(ev.pens[1])} dans la séance.`, 2, 12000);
        break;
      case 'pens_end':
        this.pbp(`C'est terminé ! ${this.tname(ev.winner)} remporte la séance de tirs au but ${nb(Math.max(...ev.pens))} à ${nb(Math.min(...ev.pens))} !`, 3, 20000);
        this.cons(`Quelle émotion ! Bravo à ${this.tname(ev.winner)}.`, 2, 20000);
        break;
      default: break;
    }
  }

  halftime(ev) {
    const m = this.m, s = ev.score;
    const st = m.stats;
    const tot = st[0].poss + st[1].poss || 1;
    const p0 = Math.round((100 * st[0].poss) / tot);
    this.pbp(`C'est la mi-temps ! ${this.tname(0)} ${nb(s[0])}, ${this.tname(1)} ${nb(s[1])}.`, 3, 20000);
    const dom = p0 >= 55 ? 0 : p0 <= 45 ? 1 : -1;
    if (dom >= 0) this.cons(`${this.tname(dom)} a eu le ballon, ${dom === 0 ? p0 : 100 - p0} pour cent de possession, ${st[dom].shots} tirs. ${s[dom] > s[1 - dom] ? 'Et ça paye au tableau d\'affichage.' : s[dom] < s[1 - dom] ? 'Mais ce sont les autres qui mènent, c\'est le football.' : 'Il manque juste l\'efficacité.'}`, 2, 25000);
    else this.cons(`Une première période très équilibrée, avec ${st[0].shots + st[1].shots} tirs au total. ${s[0] === s[1] ? 'Le score est logique.' : 'Tout reste possible.'}`, 2, 25000);
    this.pbp('On se retrouve dans quelques instants pour la seconde période.', 1, 25000);
  }

  fulltime(ev) {
    const s = ev.score;
    const w = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
    this.pbp(`C'est terminé ! Score final : ${this.tname(0)} ${nb(s[0])}, ${this.tname(1)} ${nb(s[1])} !`, 3, 20000);
    if (w >= 0) this.cons(pick([`Belle victoire de ${this.tname(w)}, qui a su faire la différence au bon moment.`, `${this.tname(w)} l'emporte, et c'est mérité sur l'ensemble du match.`, `Trois points précieux pour ${this.tname(w)}.`]), 2, 25000);
    else if (!(this.m.knockout)) this.cons(pick(['Un match nul qui ne fait les affaires de personne.', 'Partage des points, c\'est plutôt logique.', 'Un point chacun, et beaucoup de regrets des deux côtés.']), 2, 25000);
    const best = this.motm();
    if (best) this.pbp(`L'homme du match : ${best.data.name}.`, 1, 30000);
  }

  motm() {
    let best = null, bs = -1;
    for (const t of this.m.teams) for (const p of t.players) { const s = p.rating + p.goals * 1.2 + (p.data.ovr - 70) / 20; if (s > bs) { bs = s; best = p; } }
    return best;
  }

  // ---------- Temps morts : les commentateurs discutent ----------
  tick(dt, live) {
    this.silence += dt;
    if (!live || voice.busy()) return;
    if (this.silence < 14 + Math.random() * 10) return;
    this.silence = 0;
    const m = this.m;
    const r = Math.random();
    if (r < 0.3) this.playerFact();
    else if (r < 0.5) this.statTalk();
    else if (r < 0.65) this.dialogue();
    else if (r < 0.8) this.atmosphere();
    else this.tactical();
  }

  randomPlayer(teamIdx) {
    const t = teamIdx ?? (Math.random() < 0.5 ? 0 : 1);
    const ps = this.m.teams[t].players.filter(p => !p.off);
    const stars = ps.filter(p => p.data.star && !this.mentioned.has(p.data.id));
    return (stars.length && chance(0.6)) ? pick(stars) : pick(ps);
  }

  playerFact() {
    const b = this.m.ball.owner;
    const p = b && !this.mentioned.has(b.data.id) ? b : this.randomPlayer();
    const d = p.data;
    this.mentioned.add(d.id);
    const nat = NATIONS[d.nation];
    const team = this.m.teams[p.team].data;
    const facts = [
      `${d.name}, ${d.age} ans, ${ROLE_LABEL[d.role] || 'joueur'} ${nat.adj} de ${team.name}.`,
      `On surveille ${d.name}, le numéro ${d.number}. ${d.star ? 'C\'est l\'un des meilleurs joueurs du championnat.' : 'Un joueur très régulier cette saison.'}`,
      `${d.name} est ${d.foot === 'gauche' ? 'gaucher' : 'droitier'}, ${d.attrs.pac > 82 ? 'et il va très vite' : d.attrs.pas > 82 ? 'avec une qualité de passe exceptionnelle' : d.attrs.def > 80 ? 'un vrai patron en défense' : 'un joueur complet'}.`,
    ];
    this.pbp(pick(facts), 1, 8000);
    const g = this.ctx.seasonGoals?.[d.id];
    if (g && chance(0.7)) this.cons(`Il en est déjà à ${nb(g)} but${g > 1 ? 's' : ''} cette saison.`, 1, 10000);
    else if (d.star) this.cons(pick([`C'est lui qu'il faut surveiller, il peut faire basculer un match à tout moment.`, `Un talent rare. Les grands clubs européens le suivent de près.`, `Quand il touche le ballon, il se passe toujours quelque chose.`]), 1, 10000);
    else if (d.age < 21) this.cons(`À ${d.age} ans, il a un avenir énorme.`, 1, 10000);
    else if (d.age > 32) this.cons(`À ${d.age} ans, il apporte toute son expérience.`, 1, 10000);
  }

  statTalk() {
    const st = this.m.stats;
    const tot = st[0].poss + st[1].poss || 1;
    const p0 = Math.round((100 * st[0].poss) / tot);
    const r = Math.random();
    if (r < 0.4) this.pbp(`${p0} pour cent de possession pour ${this.tname(0)}, ${100 - p0} pour ${this.tname(1)}.`, 1, 8000);
    else if (r < 0.7) this.pbp(`${nb(st[0].shots)} tirs pour ${this.tname(0)}, ${nb(st[1].shots)} pour ${this.tname(1)} depuis le début de la rencontre.`, 1, 8000);
    else this.pbp(`${nb(st[0].corners + st[1].corners)} corners et ${nb(st[0].fouls + st[1].fouls)} fautes dans ce match.`, 1, 8000);
    const dom = p0 > 56 ? 0 : p0 < 44 ? 1 : -1;
    if (dom >= 0) this.cons(pick([`${this.tname(dom)} confisque le ballon, l'adversaire court beaucoup.`, `On sent que ${this.tname(dom)} a pris le contrôle du milieu de terrain.`, `${this.tname(1 - dom)} attend, en bloc bas, pour partir en contre.`]), 1, 10000);
    else this.cons(pick(['C\'est un match très équilibré.', 'Aucune équipe ne prend vraiment le dessus pour le moment.']), 1, 10000);
  }

  dialogue() {
    const s = this.m.score;
    const lead = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
    const min = this.m.minute();
    const lines = [];
    if (lead === -1) {
      lines.push(['pbp', `Didier, qui peut faire la différence dans ce match ?`]);
      lines.push(['cons', pick([`Je pense que le premier but sera décisif. Celui qui marque prendra un gros avantage.`, `Les coups de pied arrêtés, Jean-Marc. Dans un match aussi fermé, ça peut se jouer là-dessus.`, `Les entrants. Les remplaçants vont avoir un rôle à jouer en fin de match.`])]);
    } else {
      const trail = 1 - lead;
      lines.push(['pbp', `Didier, que doit faire ${this.tname(trail)} pour revenir ?`]);
      lines.push(['cons', pick([`Il faut prendre plus de risques, mettre plus de monde dans la surface.`, `Ils doivent jouer plus vite vers l'avant, là c'est trop lent.`, `Être patients. Il reste ${90 - min} minutes, c'est encore largement jouable.`])]);
    }
    if (chance(0.5)) lines.push(['pbp', pick(['Tout à fait d\'accord.', 'On va voir si l\'entraîneur réagit.', 'C\'est exactement ce qu\'on voit sur le terrain.'])]);
    lines.forEach(([w, t]) => this.say(w, t, 1, 15000));
  }

  atmosphere() {
    const { stadium, night, home } = this.ctx;
    this.pbp(pick([
      `Ambiance incroyable ce ${night ? 'soir' : 'jour'} au ${stadium}.`,
      `Écoutez ce public ! Les supporters de ${home.name} poussent derrière leur équipe.`,
      `Le stade est à guichets fermés, ${(home.capacity || 45000).toLocaleString('fr-FR')} spectateurs.`,
      `Les supporters donnent de la voix dans le virage.`,
    ]), 1, 8000);
    if (chance(0.5)) this.cons(pick(['C\'est un vrai douzième homme, ce public.', 'Ça fait plaisir de voir un stade comme ça.', 'Les joueurs le sentent, ça les pousse.']), 1, 10000);
  }

  tactical() {
    const t = Math.random() < 0.5 ? 0 : 1;
    const team = this.team(t);
    this.cons(pick([
      `Tactiquement, ${team.name} joue en ${team.formation}, avec un bloc ${team.style === 'pressing' ? 'très haut et un pressing intense' : team.style === 'contre' ? 'bas, pour exploiter les contres' : 'assez compact'}.`,
      `On voit bien que ${team.name} cherche à passer par les côtés.`,
      `L'entraîneur ${team.coach} donne beaucoup de consignes depuis le bord du terrain.`,
      `${team.name} manque un peu de justesse dans la dernière passe.`,
    ]), 1, 10000);
  }
}

function ordinal(n, fem = false) {
  if (n === 1) return fem ? 'premier' : 'premier';
  return `${n}e`;
}
function styleText(s) {
  return { possession: 'la possession du ballon', contre: 'les contre-attaques', direct: 'un jeu direct vers l\'avant', pressing: 'un pressing très haut', 'équilibré': 'un bon équilibre' }[s] || 'un collectif solide';
}
