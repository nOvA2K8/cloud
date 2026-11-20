// Kostenlose Web-Recherche ohne API-Schlüssel: DuckDuckGo-Suche und Seiten lesen.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function unwrapDdg(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  let u = m ? decodeURIComponent(m[1]) : href;
  if (u.startsWith('//')) u = 'https:' + u;
  return u;
}

async function webSearch(query, max = 8) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (HTTP ${res.status})`);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(re)];
  for (let k = 0; k < matches.length && results.length < max; k++) {
    const m = matches[k];
    const url = unwrapDdg(decodeEntities(m[1]));
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // Werbung
    // Snippet steht zwischen diesem und dem nächsten Treffer
    const end = k + 1 < matches.length ? matches[k + 1].index : html.length;
    const block = html.slice(m.index + m[0].length, end);
    const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
    results.push({ title: stripTags(m[2]), url, snippet: sn ? stripTags(sn[1]) : '' });
  }
  if (!results.length) return 'Keine Treffer (oder die Suche wurde vorübergehend blockiert – später erneut versuchen).';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => '\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n')
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function fetchUrl(url, maxChars = 12000) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Nur http(s)-Adressen');
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) throw new Error('Lokale Adressen sind gesperrt');
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  const text = /html/i.test(type) ? htmlToText(body) : body;
  return text.length > maxChars ? text.slice(0, maxChars) + `\n[... gekürzt, ${text.length} Zeichen gesamt]` : text;
}

module.exports = { webSearch, fetchUrl, htmlToText };
