'use strict';
// Çakışma tespiti (saf mantık; Electron'a bağımlı değil, model çağrısı dışarıdan verilir).
// Paylaşılan kayıtlar (karar, görev, konu, not) ile yeni isteği karşılaştırır.
// Hiçbir şey sunucuya yazılmaz; yalnızca verilen `ask` ile yerel küçük model çağrılır.

const MAX_CANDIDATES = 20;
const STOP = new Set('ve ile bir bu şu o için de da ki mi mı mu mü gibi daha çok en her tüm bütün olsun olacak yap yapılsın et edilsin olarak ama veya ya hem şey the a an of to and for is are be'.split(' '));

function words(s) {
  return String(s || '').toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
}
// Türkçe ekleri kabaca yok saymak için ilk 5 harf (karakter→karakterler/karakterin)
const stem = (w) => w.slice(0, 5);

// request: { title, description, repo, area }
// context: { decisions[], tasks[], topics[], notes[] } — her biri sunucudan okunmuş satırlar
function collectCandidates(request, context) {
  const reqStems = new Set(words(`${request.title} ${request.description} ${request.area || ''}`).map(stem));
  const out = [];
  const consider = (kind, id, text, repo, extra) => {
    const sameRepo = !request.repo || !repo || repo === request.repo;
    if (!sameRepo) return;
    const hit = words(text).map(stem).filter((w) => reqStems.has(w));
    const score = new Set(hit).size;
    if (score > 0) out.push({ kind, id, text: String(text).slice(0, 400), repo: repo || null, score, ...extra });
  };
  for (const d of context.decisions || []) if (d.active !== false) consider('karar', d.id, `${d.statement} ${d.area || ''}`, d.repo);
  for (const t of context.tasks || []) if (['pending', 'accepted', 'running', 'discussion'].includes(t.status)) consider('görev', t.id, `${t.title} ${t.description || ''}`, t.repo, { status: t.status });
  for (const t of context.topics || []) if (t.status === 'open') consider('konu', t.id, `${t.title} ${t.current_state || ''} ${t.request_a || ''} ${t.request_b || ''}`, t.repo);
  for (const n of context.notes || []) consider('not', n.id, `${n.title} ${String(n.body || '').slice(0, 1500)}`, n.repo);
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_CANDIDATES);
}

const SYSTEM = `Bir yazılım/oyun ekibinin çakışma denetçisisin. Yeni bir istek ile mevcut kayıtları (kararlar, açık görevler, açık konular, toplantı notları) karşılaştır.
Yalnızca geçerli JSON döndür, başka metin yazma:
{"verdict":"none"|"minor"|"major","reason":"kısa Türkçe gerekçe","items":[{"kind":"karar|görev|konu|not","id":"...","why":"neden çelişiyor"}],"options":[{"label":"kısa başlık","detail":"tek cümle","kind":"a|b|balanced"}]}
Kurallar:
- none: gerçek bir çelişki/üst üste binme yok (aynı kelimenin geçmesi çelişki değildir).
- minor: küçük, düşük riskli üst üste binme (aynı işi tekrarlama, kozmetik fark); kolayca yoksayılabilir ya da birleştirilebilir.
- major: doğrudan çelişki ya da birbirini bozan iki karar (ör. "tüm karakterler siyah gözlü" ile "karakterin gözünü sarıya çevir").
- major ise options tam 3 tane olsun: a = mevcut durumu koru, b = yeni isteği uygula, balanced = ikisini dengeleyen alternatif. none/minor ise options boş dizi.
- items'ta yalnızca verilen kayıtların gerçek id'lerini kullan.`;

function buildPrompt(request, candidates) {
  const list = candidates.map((c) => `- [${c.kind} ${c.id}${c.status ? ' ' + c.status : ''}${c.repo ? ' ' + c.repo : ''}] ${c.text}`).join('\n');
  return `YENİ İSTEK${request.repo ? ' (repo: ' + request.repo + ')' : ''}:\nBaşlık: ${request.title}\nAçıklama: ${request.description || '-'}\n\nMEVCUT KAYITLAR:\n${list}`;
}

function parseVerdict(text, candidates) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!['none', 'minor', 'major'].includes(j.verdict)) return null;
  const ids = new Set(candidates.map((c) => String(c.id)));
  const items = (Array.isArray(j.items) ? j.items : []).filter((i) => i && ids.has(String(i.id))).map((i) => ({ kind: i.kind, id: String(i.id), why: String(i.why || '').slice(0, 300) }));
  let verdict = j.verdict;
  if (verdict !== 'none' && !items.length) verdict = 'none';   // gerçek bir kayda dayanmayan iddia geçersiz
  const options = verdict === 'major' ? (Array.isArray(j.options) ? j.options : []).slice(0, 3).map((o) => ({ label: String(o.label || '').slice(0, 80), detail: String(o.detail || '').slice(0, 300), kind: ['a', 'b', 'balanced'].includes(o.kind) ? o.kind : 'balanced' })) : [];
  return { verdict, reason: String(j.reason || '').slice(0, 400), items, options };
}

// ask(system, user) -> Promise<string>
async function detectConflict(request, context, ask) {
  const candidates = collectCandidates(request, context);
  if (!candidates.length) return { verdict: 'none', reason: 'Karşılaştırılacak ilgili kayıt yok.', items: [], options: [], candidates: 0 };
  let text;
  try { text = await ask(SYSTEM, buildPrompt(request, candidates)); } catch (e) {
    return { verdict: 'unknown', reason: 'Çakışma kontrolü yapılamadı: ' + (e && e.message || e), items: [], options: [], candidates: candidates.length };
  }
  const v = parseVerdict(text, candidates);
  if (!v) return { verdict: 'unknown', reason: 'Model yanıtı çözümlenemedi.', items: [], options: [], candidates: candidates.length };
  return Object.assign(v, { candidates: candidates.length });
}

module.exports = { detectConflict, collectCandidates, buildPrompt, parseVerdict, SYSTEM };
