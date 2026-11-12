'use strict';
// Çakışma tespitini gerçek Haiku çağrısıyla dener: node scripts/conflict-test.js
const { detectConflict } = require('../conflict');
const os = require('os');
(async () => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const exe = process.env.CLAUDE_EXE;
  const ask = async (system, user) => {
    let out = '';
    for await (const m of query({ prompt: user, options: { cwd: os.tmpdir(), pathToClaudeCodeExecutable: exe, model: 'claude-haiku-5-5', systemPrompt: system, settingSources: [], tools: [], maxTurns: 1, persistSession: false, env: { ...process.env, CLAUDE_CONFIG_DIR: os.homedir() + '/.claude-ekip' } } })) {
      if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') out += b.text;
    }
    return out;
  };
  const ctx = {
    decisions: [{ id: 'd1', statement: 'Tüm karakterler siyah gözlü olacak', area: 'karakter', repo: 'ekip/party-league', active: true }],
    tasks: [{ id: 't1', title: 'Skor tablosuna animasyon ekle', description: 'Puan artınca sayı zıplasın', status: 'running', repo: 'ekip/party-league' }],
    topics: [], notes: [{ id: 'n1', title: 'Pazartesi toplantısı', body: 'Ses efektleri için tek paket kullanılacak, kaynak Kenney.', repo: 'ekip/party-league' }]
  };
  const cases = [
    { name: 'ÇELİŞKİ (göz rengi)', req: { title: 'Karakterin gözünü sarıya çevir', description: 'Ana karakterin gözleri sarı olsun', repo: 'ekip/party-league' } },
    { name: 'ÜST ÜSTE (skor animasyonu)', req: { title: 'Skor sayısına zıplama efekti', description: 'Puan değişince skor yazısı animasyonlu olsun', repo: 'ekip/party-league' } },
    { name: 'ALAKASIZ', req: { title: 'Ayarlar menüsüne dil seçeneği ekle', description: 'Türkçe ve İngilizce', repo: 'ekip/party-league' } }
  ];
  for (const c of cases) {
    const r = await detectConflict(c.req, ctx, ask);
    console.log('\n==', c.name, '->', r.verdict, `(aday ${r.candidates})`, '\n  neden:', r.reason, '\n  kayıtlar:', JSON.stringify(r.items), '\n  seçenekler:', JSON.stringify(r.options));
  }
})();
