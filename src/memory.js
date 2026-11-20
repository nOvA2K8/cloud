// Langzeitgedächtnis: Die KI merkt sich Lösungen, Fehler und Vorlieben über alle Projekte hinweg.
// Kein Training – ein lokaler Wissensspeicher, der vor jeder Aufgabe durchsucht wird.
const fs = require('fs');
const path = require('path');

const STOP = new Set('der die das und oder ein eine einen einem mit für von zu im in ist sind auf an als auch nicht the a an and or of to in is for with on it this that be are'.split(' '));

// Deutsch/Englisch-Synonyme für typische Spielbegriffe, damit "Autos" auch "Vehicles" findet.
const SYN_GROUPS = [
  ['auto', 'autos', 'fahrzeug', 'fahrzeuge', 'car', 'cars', 'vehicle', 'vehicles', 'chaosvehicles'],
  ['waffe', 'waffen', 'weapon', 'weapons', 'gun', 'guns', 'schießen', 'shoot', 'shooting'],
  ['stadt', 'city', 'städte', 'town', 'gebäude', 'building', 'buildings'],
  ['fußgänger', 'npc', 'npcs', 'crowd', 'crowds', 'pedestrian', 'pedestrians', 'masscrowd'],
  ['verkehr', 'traffic'],
  ['karte', 'welt', 'map', 'world', 'worldpartition', 'landschaft', 'landscape', 'terrain'],
  ['fehler', 'error', 'errors', 'build', 'kompilieren', 'compile', 'linker'],
  ['spieler', 'player', 'character', 'figur', 'charakter'],
  ['polizei', 'police', 'wanted', 'fahndung'],
  ['mission', 'missionen', 'missions', 'quest', 'quests', 'aufgabe'],
  ['licht', 'beleuchtung', 'lighting', 'lumen', 'tag', 'nacht', 'day', 'night'],
  ['steuerung', 'input', 'controls', 'enhancedinput', 'tasten'],
];
const SYN = new Map();
SYN_GROUPS.forEach((g, i) => g.forEach((w) => SYN.set(w, `#${i}#`)));

function tokens(s) {
  const out = [];
  for (const w of String(s).toLowerCase().split(/[^a-z0-9äöüß_]+/)) {
    if (w.length <= 2 || STOP.has(w)) continue;
    out.push(w);
    if (SYN.has(w)) out.push(SYN.get(w));
  }
  return out;
}

class Memory {
  constructor(file) {
    this.file = file;
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* leer */ }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 1));
  }

  remember(text, tags = '') {
    const t = String(text).trim();
    if (!t) return 'Nichts zu merken.';
    // Doppelte Einträge vermeiden
    if (this.items.some((i) => i.text === t)) return 'Ist schon gespeichert.';
    this.items.push({ id: Date.now().toString(36), text: t.slice(0, 4000), tags: String(tags), created: new Date().toISOString(), uses: 0 });
    if (this.items.length > 5000) this.items.sort((a, b) => b.uses - a.uses).length = 5000;
    this.save();
    return `Gemerkt (${this.items.length} Einträge im Gedächtnis).`;
  }

  recall(query, limit = 6) {
    const q = tokens(query);
    if (!q.length) return [];
    const scored = this.items.map((i) => {
      const words = tokens(i.text + ' ' + i.tags);
      let score = 0;
      for (const w of new Set(q)) score += words.some((x) => x === w || (w.length > 3 && x.length > 3 && (x.startsWith(w) || w.startsWith(x)))) ? 1 : 0;
      return { i, score: score + Math.min(i.uses, 5) * 0.05 };
    }).filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit);
    for (const s of scored) s.i.uses++;
    if (scored.length) this.save();
    return scored.map((s) => s.i);
  }

  format(items) {
    return items.map((i) => `- ${i.text}${i.tags ? ` [${i.tags}]` : ''}`).join('\n');
  }
}

module.exports = { Memory };
