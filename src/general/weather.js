// Météo : vraies prévisions (Open-Meteo, sans clé) pour les grandes villes
// françaises, avec repli sur des prévisions simulées si le réseau manque.
import { RNG } from '../core/rng.js';

export const CITIES = [
  ['Lille', 50.63, 3.06], ['Paris', 48.86, 2.35], ['Strasbourg', 48.58, 7.75], ['Brest', 48.39, -4.49], ['Rennes', 48.11, -1.68], ['Nantes', 47.22, -1.55],
  ['Dijon', 47.32, 5.04], ['Lyon', 45.76, 4.84], ['Bordeaux', 44.84, -0.58], ['Clermont-Fd', 45.78, 3.08], ['Toulouse', 43.6, 1.44], ['Marseille', 43.3, 5.37],
  ['Nice', 43.7, 7.27], ['Ajaccio', 41.93, 8.74], ['Biarritz', 43.48, -1.56], ['Grenoble', 45.19, 5.72],
];

// Contour simplifié de la France métropolitaine (longitude, latitude)
export const FRANCE = [[2.55, 51.09], [3.2, 50.75], [4.2, 50.0], [4.85, 50.15], [5.4, 49.6], [6.36, 49.47], [7.0, 49.12], [8.2, 48.98], [7.8, 48.6], [7.55, 47.6], [7.0, 47.45], [6.45, 46.95], [6.1, 46.2], [6.8, 46.4], [7.0, 45.9], [6.65, 45.1], [7.05, 44.8], [6.9, 44.4], [7.5, 43.8], [7.27, 43.7], [6.6, 43.15], [5.9, 43.08], [5.37, 43.3], [4.6, 43.4], [3.5, 43.28], [3.05, 42.6], [3.17, 42.43], [2.5, 42.35], [1.7, 42.5], [0.7, 42.85], [-0.3, 42.8], [-1.15, 43.0], [-1.78, 43.37], [-1.45, 43.7], [-1.25, 44.6], [-1.2, 45.6], [-1.25, 46.15], [-2.0, 46.8], [-2.25, 47.05], [-2.5, 47.3], [-3.1, 47.5], [-4.35, 47.8], [-4.75, 48.05], [-4.78, 48.4], [-4.6, 48.62], [-3.6, 48.75], [-2.9, 48.55], [-2.0, 48.65], [-1.55, 48.65], [-1.6, 49.2], [-1.95, 49.72], [-1.25, 49.68], [-1.1, 49.38], [-0.35, 49.32], [0.1, 49.5], [0.6, 49.86], [1.4, 50.07], [1.6, 50.45], [1.62, 50.8], [1.9, 50.97]];
export const CORSICA = [[9.4, 43.0], [9.55, 42.6], [9.4, 41.95], [9.2, 41.38], [8.8, 41.6], [8.6, 42.1], [8.65, 42.55], [9.2, 42.75]];

export function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '⛅';
}
export function weatherWord(code) {
  if (code === 0) return 'un grand soleil';
  if (code <= 2) return 'un ciel partagé entre nuages et éclaircies';
  if (code === 3) return 'un ciel couvert';
  if (code === 45 || code === 48) return 'du brouillard';
  if (code >= 51 && code <= 57) return 'de la bruine';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'de la pluie';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'de la neige';
  if (code >= 95) return 'des orages';
  return 'des nuages';
}

// Prévisions simulées (climatologie approximative par mois et par latitude)
function fake(dayNo) {
  const month = new Date(dayNo * 86400000).getMonth();
  const base = [6, 7, 11, 14, 18, 22, 25, 25, 21, 16, 10, 7][month];
  return CITIES.map(([name, lat, lon], i) => {
    const days = [0, 1, 2, 3].map(d => {
      const r = new RNG(`wx-${dayNo + d}-${Math.round(lat)}-${Math.round(lon / 3)}`);
      const south = (47 - lat) * 0.9 + (lon > 6 && lat < 44 ? 1.5 : 0);
      const max = Math.round(base + south + r.range(-3, 3));
      const wet = r.next() < (lat > 47 ? 0.45 : 0.25);
      const code = wet ? r.pick([3, 61, 63, 80, 51]) : r.pick([0, 1, 2, 2, 3]);
      return { max, min: Math.round(max - r.range(6, 10)), code: month < 2 && max < 5 && wet ? 71 : code };
    });
    return { name, lat, lon, now: { temp: Math.round((days[0].max + days[0].min) / 2), code: days[0].code, wind: 10 + (i * 7) % 25 }, days };
  });
}

let cache = null;
export async function getWeather(dayNo) {
  if (cache && cache.dayNo === dayNo && (cache.real || Date.now() - cache.at < 600000)) return cache;
  const out = { dayNo, at: Date.now(), real: false, cities: fake(dayNo) };
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CITIES.map(c => c[1]).join(',')}&longitude=${CITIES.map(c => c[2]).join(',')}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FParis&forecast_days=4`;
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    if (res.ok) {
      const js = await res.json();
      const arr = Array.isArray(js) ? js : [js];
      if (arr.length === CITIES.length) {
        out.cities = arr.map((d, i) => ({
          name: CITIES[i][0], lat: CITIES[i][1], lon: CITIES[i][2],
          now: { temp: Math.round(d.current.temperature_2m), code: d.current.weather_code, wind: Math.round(d.current.wind_speed_10m) },
          days: d.daily.time.map((_, k) => ({ max: Math.round(d.daily.temperature_2m_max[k]), min: Math.round(d.daily.temperature_2m_min[k]), code: d.daily.weather_code[k] })),
        }));
        out.real = true;
      }
    }
  } catch (e) { /* hors ligne : prévisions simulées */ }
  cache = out;
  return out;
}
