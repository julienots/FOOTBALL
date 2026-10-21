// Génère l'icône et l'écran de démarrage Android (rendu via Chromium/Playwright)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const res = path.join(__dirname, '../android/app/src/main/res');
const draw = `
function icon(c, s, mode) {
  const g = c.getContext('2d'); c.width = c.height = s;
  const u = s / 108;
  if (mode !== 'fg') {
    g.fillStyle = '#0b1220';
    if (mode === 'round') { g.beginPath(); g.arc(s/2, s/2, s/2, 0, 7); g.fill(); g.save(); g.beginPath(); g.arc(s/2, s/2, s/2, 0, 7); g.clip(); }
    else { g.fillRect(0, 0, s, s); }
  }
  const k = mode === 'fg' ? 1 : 1.45; // les icônes classiques sont plus "zoomées"
  g.translate(s/2, s/2); g.scale(k, k); g.translate(-s/2, -s/2);
  // écran de TV
  const x = 26*u, y = 32*u, w = 56*u, h = 38*u, r = 6*u;
  g.fillStyle = '#e8edf5';
  g.beginPath(); g.roundRect(x-3*u, y-3*u, w+6*u, h+6*u, r+2*u); g.fill();
  const grd = g.createLinearGradient(0, y, 0, y+h); grd.addColorStop(0, '#2e9e3e'); grd.addColorStop(1, '#1b6b28');
  g.fillStyle = grd; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.save(); g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 7; i += 2) g.fillRect(x + i*w/7, y, w/7, h);
  g.strokeStyle = '#fff'; g.lineWidth = 1.4*u; g.beginPath(); g.moveTo(x+w/2, y); g.lineTo(x+w/2, y+h); g.stroke();
  g.beginPath(); g.arc(x+w/2, y+h/2, 7*u, 0, 7); g.stroke();
  g.restore();
  // ballon
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x+w*0.72, y+h*0.62, 6*u, 0, 7); g.fill();
  g.fillStyle = '#111'; g.beginPath(); for (let i=0;i<5;i++){const a=i/5*Math.PI*2-Math.PI/2; g.lineTo(x+w*0.72+Math.cos(a)*2.4*u, y+h*0.62+Math.sin(a)*2.4*u);} g.fill();
  // pied + antenne
  g.strokeStyle = '#e8edf5'; g.lineWidth = 3*u; g.lineCap='round';
  g.beginPath(); g.moveTo(44*u, 22*u); g.lineTo(54*u, 30*u); g.lineTo(64*u, 22*u); g.stroke();
  g.fillStyle = '#e8edf5'; g.fillRect(46*u, 74*u, 16*u, 3*u);
  // pastille "IA"
  g.fillStyle = '#d50000'; g.beginPath(); g.roundRect(64*u, 62*u, 22*u, 14*u, 4*u); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold ' + (10*u) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('IA', 75*u, 69.5*u);
}
function splash(c, w, h) {
  const g = c.getContext('2d'); c.width = w; c.height = h;
  const grd = g.createRadialGradient(w/2, h*0.45, 0, w/2, h/2, Math.max(w,h)*0.7); grd.addColorStop(0, '#1b2a45'); grd.addColorStop(1, '#03050a');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const s = Math.min(w, h) * 0.32; const ic = document.createElement('canvas'); icon(ic, s, 'fg');
  g.drawImage(ic, w/2 - s/2, h/2 - s*0.75);
  g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(s*0.2) + 'px Arial'; g.textAlign = 'center'; g.fillText('SPORT TV IA', w/2, h/2 + s*0.42);
}`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ content: draw });
  const out = async (file, fn) => {
    const data = await p.evaluate(fn);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  };
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await out(`${res}/mipmap-${d}/ic_launcher.png`, `(()=>{const c=document.createElement('canvas');icon(c,${48 * k},'sq');return c.toDataURL('image/png')})()`);
    await out(`${res}/mipmap-${d}/ic_launcher_round.png`, `(()=>{const c=document.createElement('canvas');icon(c,${48 * k},'round');return c.toDataURL('image/png')})()`);
    await out(`${res}/mipmap-${d}/ic_launcher_foreground.png`, `(()=>{const c=document.createElement('canvas');icon(c,${108 * k},'fg');return c.toDataURL('image/png')})()`);
  }
  const fsx = require('fs');
  for (const f of fsx.readdirSync(res).filter(x => x.startsWith('drawable'))) {
    const file = `${res}/${f}/splash.png`;
    if (!fsx.existsSync(file)) continue;
    const buf = fsx.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    await out(file, `(()=>{const c=document.createElement('canvas');splash(c,${w},${h});return c.toDataURL('image/png')})()`);
  }
  await b.close();
})();
