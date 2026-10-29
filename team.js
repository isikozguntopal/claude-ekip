// Ekip tanımları — hem main (kurulum/durum) hem renderer (çizim/aktivite) kullanır.
(function (root) {
  // 16x17 temel karakter. Harfler her üyenin paletinden renk alır, '.' boş.
  const BASE = [
    '....kkkkkkkk....',
    '...khhhhhhhhk...',
    '..khhhhhhhhhhk..',
    '..khsssssssshk..',
    '..kssssssssssk..',
    '..kssessssessk..',
    '..ksrssssssrsk..',
    '..kssssmmssssk..',
    '...kssssssssk...',
    '...kcccssccck...',
    '..kccccCCcccck..',
    '..kscccCCcccsk..',
    '..kscccCCcccsk..',
    '...kppppppppk...',
    '...kpppkkpppk...',
    '...kbbbk.kbbbk..',
    '...kkkkk.kkkkk..'
  ];

  const COMMON = { k: '#1b1626', s: '#f2c79a', e: '#1b1626', r: '#f29b8f', m: '#a8534a', p: '#33384f', b: '#16131d' };

  const TEAM = [
    {
      id: 'lider',
      name: 'Claude',
      title: 'Ekip Lideri',
      color: '#d97757',
      plugin: null,
      builtIn: true,
      tagline: 'Sizinle konuşan, işi ekibe dağıtan ana ajan.',
      what:
        'Sohbet kutusuna yazdığınız her şeyi o alır. İşi anlar, gerekirse ekipteki uzmanların skill/komut/hook\'larını devreye sokar, dosya okur-yazar, komut çalıştırır. Diğer üyeler aslında Claude\'un yüklediği uzmanlık paketleridir; hangisi devreye girerse onun avatarı yanar.',
      runs: [
        'Claude Code CLI (masaüstü uygulamasının imzalı claude.exe\'si) — Agent SDK ile canlı oturum',
        'Araçlar: Read, Edit, Write, Bash, Grep, Glob, Agent (alt ajan), Skill …',
        'Sizin ~/.claude ayarlarınız + workspace\'in .claude/settings.json\'ı yüklenir',
        'Sinir ağı (codebase-memory MCP): search_graph / trace_path ile "kim çağırıyor, ne etkilenir" sorularını dosya taramadan, az token\'la cevaplar'
      ],
      quick: [
        { label: 'Projeyi tanı', text: 'Bu projeyi incele: yapısını, teknolojilerini ve nasıl çalıştırıldığını kısaca özetle.' },
        { label: 'Ekip yüklendi mi?', text: 'Bu oturumda hangi plugin, skill ve hook\'lar yüklü? Kısa liste ver.' }
      ],
      match: {},
      sprite: {
        grid: [
          '................',
          '................',
          '................',
          '................',
          '...oooooooooo...',
          '...oooooooooo...',
          '...ookooookoo...',
          '...ookooookoo...',
          '.oooooooooooooo.',
          '.oooooooooooooo.',
          '...oooooooooo...',
          '...oooooooooo...',
          '...oooooooooo...',
          '...o.o....o.o...',
          '...o.o....o.o...',
          '................',
          '................'
        ],
        palette: { o: '#d97757', k: '#1b1626' }
      }
    },
    {
      id: 'mimar',
      name: 'Süper Mimar',
      title: 'Planlama & TDD',
      color: '#7b5cf0',
      plugin: 'superpowers',
      installId: 'superpowers@anthropic-plugin-directory',
      repo: 'https://github.com/obra/superpowers',
      tagline: 'Kod yazmadan önce düşünür, planlar, testi önce yazar.',
      what:
        'Yeni bir iş geldiğinde hemen koda atlamaz: önce ne istediğinizi sorup bir spec çıkarır, onayınızdan sonra adım adım uygulama planı yazar, her adımı önce test (kırmızı) sonra kod (yeşil) ile ilerletir, görevleri alt ajanlara dağıtıp birbirinin işini kontrol ettirir. Bitirmeden önce gerçekten çalıştığını doğrular.',
      runs: [
        'SessionStart hook → oturum açılırken "using-superpowers" talimatını enjekte eder',
        'Skill: brainstorming → writing-plans → executing-plans',
        'Skill: test-driven-development, systematic-debugging, verification-before-completion',
        'Skill: subagent-driven-development, dispatching-parallel-agents (Agent aracıyla alt ajanlar)',
        'Skill: requesting-code-review, finishing-a-development-branch, using-git-worktrees'
      ],
      quick: [
        { label: 'Beyin fırtınası', text: '/superpowers:brainstorming ' },
        { label: 'Plan yaz', text: '/superpowers:writing-plans ' },
        { label: 'Hata ayıkla', text: '/superpowers:systematic-debugging ' },
        { label: 'TDD ile geliştir', text: '/superpowers:test-driven-development ' }
      ],
      match: { skill: /^superpowers:/i, command: /^\/superpowers:/i, hookText: /superpowers/i },
      sprite: {
        palette: { h: '#4a2f22', c: '#7b5cf0', C: '#5a3cc9', a: '#ffd23f', g: '#1b1626' },
        patches: [
          { x: 4, y: 4, rows: ['ggg..ggg', 'g.gggg.g'] },
          { x: 7, y: 10, rows: ['.a', 'aa', 'a.'] }
        ]
      }
    },
    {
      id: 'tasarimci',
      name: 'Piksel',
      title: 'Frontend Tasarımcı',
      color: '#ff6fae',
      plugin: 'frontend-design',
      installId: 'frontend-design@anthropic-plugin-directory',
      repo: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design',
      tagline: 'Arayüzleri "yapay zekâ yaptı" gibi değil, tasarımcı elinden çıkmış gibi yapar.',
      what:
        'Arayüz işi geldiğinde kendiliğinden devreye girer: cesur bir görsel yön seçer, tipografi, renk, boşluk, animasyon ve detaylarda jenerik görünümden kaçınır, üretim kalitesinde HTML/CSS/React kodu yazar.',
      runs: [
        'Skill: frontend-design:frontend-design (frontend işinde otomatik çağrılır)',
        'Kendi komutu/hook\'u yok; Claude\'un yazdığı arayüz kodunun yönünü belirler'
      ],
      quick: [
        { label: 'Sayfa tasarla', text: '/frontend-design:frontend-design ' },
        { label: 'Arayüzü iyileştir', text: 'frontend-design skill\'iyle mevcut arayüzü incele; jenerik görünen yerleri daha özgün ve şık hale getir.' }
      ],
      match: { skill: /^frontend-design/i, command: /^\/frontend-design/i },
      sprite: {
        palette: { h: '#f0b44c', c: '#ff6fae', C: '#e04f8e', a: '#e63946', A: '#7a4a2a', B: '#4cc9f0' },
        patches: [
          { x: 4, y: 0, rows: ['aaaaaaaa'] },
          { x: 3, y: 1, rows: ['aaaaaaaaaa'] },
          { x: 14, y: 8, rows: ['B', 'A', 'A', 'A'] }
        ]
      }
    },
    {
      id: 'inceleyici',
      name: 'Dedektif',
      title: 'Kod İnceleyici',
      color: '#2ab7a9',
      plugin: 'code-review',
      installId: 'code-review-anthropics@anthropic-plugin-directory',
      repo: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review',
      tagline: 'Değişiklikleri birden çok ajanla paralel inceler, gerçek hataları yakalar.',
      what:
        'İnceleme istediğinizde aynı anda birden fazla alt ajan başlatır: biri CLAUDE.md kurallarına uyumu, biri bug\'ları, biri git geçmişini (blame/log) kontrol eder. Bulgulara güven puanı verir, düşük puanlı olanları eler ki yanlış alarm gelmesin.',
      runs: [
        'Komut: /code-review → yerel diff incelemesi (Claude Code\'un yerleşik komutu)',
        'Komut: /code-review:code-review → GitHub PR incelemesi (plugin; gh CLI gerekir)',
        'Agent aracı: paralel inceleme alt ajanları; Bash: git diff / git log / git blame'
      ],
      quick: [
        { label: 'Değişiklikleri incele', text: '/code-review' },
        { label: 'Bir dosyayı incele', text: 'Şu dosyayı bug, güvenlik ve okunabilirlik açısından incele, bulguları önem sırasıyla listele: ' }
      ],
      match: { skill: /^code-review/i, command: /^\/code-review/i, agentText: /review|incele/i },
      sprite: {
        palette: { h: '#1f1f1f', c: '#2ab7a9', C: '#1d8278', a: '#6b4a2b', g: '#d4a72c', l: '#bfe6ff', A: '#5a3a1e' },
        patches: [
          { x: 4, y: 0, rows: ['aaaaaaaa'] },
          { x: 2, y: 1, rows: ['aaaaaaaaaaaa'] },
          { x: 13, y: 7, rows: ['ggg', 'glg', 'ggg', 'A..', 'A..'] }
        ]
      }
    },
    {
      id: 'guvenlik',
      name: 'Bekçi',
      title: 'Güvenlik Görevlisi',
      color: '#3a86ff',
      plugin: 'security-guidance',
      installId: 'security-guidance@anthropic-plugin-directory',
      repo: 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/security-guidance',
      tagline: 'Claude her dosya düzenlediğinde arkadan güvenlik taraması yapar.',
      what:
        'Siz bir şey istemeden çalışır: Claude her Edit/Write yaptığında dosyayı command injection, eval, XSS, güvensiz deserialization, os.system, path traversal, SQL injection, gömülü sır gibi kalıplar için tarar ve uyarır. git commit/push sonrasında ve iş bittiğinde arka planda LLM ile ek güvenlik incelemesi yapar.',
      runs: [
        'SessionStart hook → Python ortamını hazırlar (ensure_agent_sdk.py)',
        'UserPromptSubmit + PostToolUse(Edit|Write|MultiEdit) hook → security_reminder_hook.py kalıp taraması',
        'PostToolUse(Bash: git commit / git push) → arka planda commit güvenlik incelemesi',
        'Stop / SubagentStop hook → iş bitince diff üzerinden güvenlik geri bildirimi',
        'Komut: /security-review → bekleyen değişikliklerin güvenlik incelemesi (Claude Code yerleşik)',
        'Gereksinim: Python + Git Bash'
      ],
      quick: [
        { label: 'Değişiklikleri güvenlik incele', text: '/security-review' },
        { label: 'Tüm projeyi tara', text: 'Projede güvenlik açığı olabilecek yerleri tara (injection, XSS, gömülü sırlar, güvensiz eval) ve önem sırasıyla raporla.' }
      ],
      match: { editTools: true, command: /^\/security-review/i, hookText: /security|güvenlik/i },
      sprite: {
        palette: { h: '#2b2b2b', c: '#1d3557', C: '#457b9d', a: '#3a86ff', A: '#ffd166', d: '#8d99ae', y: '#ffd166' },
        patches: [
          { x: 3, y: 0, rows: ['.aaaaaaaa.'] },
          { x: 2, y: 1, rows: ['aaaaaAaaaaaa'] },
          { x: 2, y: 2, rows: ['aaaaaaaaaaaa'] },
          { x: 12, y: 9, rows: ['ddd', 'dyd', 'ddd', '.d.'] }
        ]
      }
    },
    {
      id: 'ceo',
      name: 'Müdür',
      title: 'Yayın & Kalite Müdürü',
      color: '#e9c46a',
      plugin: 'gstack',
      installId: null,
      repo: 'https://github.com/garrytan/gstack',
      tagline: 'Planı CEO, mühendislik müdürü ve QA gözüyle sorgular, ürünü yayına taşır.',
      what:
        'Garry Tan\'ın (Y Combinator) kurulumu. /plan-ceo-review ile kapsamı ve iş değerini, /plan-eng-review ile mimariyi, /plan-design-review ile tasarımı sorgular; /review, /qa ve /ship ile kodu inceler, test eder ve yayına hazırlar.',
      runs: [
        'Skill: plan-ceo-review, plan-eng-review, plan-design-review',
        'Skill: review, qa, ship, office-hours, autoplan, cso (güvenlik denetimi) …',
        'Kurulum: ~/.claude/skills/gstack altına global kurulur, Bun + bash script\'leri ister'
      ],
      manualInstall:
        'gstack resmi plugin dizininde yok. Tam kurulum ~/.claude/skills/gstack altına GLOBAL yapılır (tüm projelerinizi etkiler) ve Bun ister; bu makinede imzasız exe\'ler EDR\'a takıldığı için /browse gibi parçalar çalışmayabilir. Kurmak isterseniz Claude Code\'a "gstack\'i kur" deyin.',
      quick: [
        { label: 'CEO incelemesi', text: '/plan-ceo-review' },
        { label: 'Yayına hazırla', text: '/ship' }
      ],
      match: { skill: /^(gstack|plan-ceo-review|plan-eng-review|plan-design-review|review|qa|qa-only|ship|office-hours|autoplan|cso|retro|investigate)$/i, command: /^\/(plan-ceo-review|plan-eng-review|plan-design-review|qa|ship|office-hours|autoplan|cso)\b/i },
      sprite: {
        palette: { h: '#141414', c: '#2b2d42', C: '#d62828', g: '#1b1626', w: '#f5f5f5' },
        patches: [
          { x: 4, y: 4, rows: ['ggg..ggg', 'g.gggg.g'] },
          { x: 6, y: 9, rows: ['wssw'] }
        ]
      }
    }
  ];

  function spriteGrid(member) {
    const sp = member.sprite;
    if (sp.grid) return { grid: sp.grid.slice(), palette: sp.palette };
    const grid = BASE.map((r) => r.split(''));
    for (const p of sp.patches || []) {
      p.rows.forEach((row, dy) => {
        row.split('').forEach((ch, dx) => {
          const y = p.y + dy, x = p.x + dx;
          if (ch !== '.' && grid[y] && x < 16) grid[y][x] = ch;
        });
      });
    }
    return { grid: grid.map((r) => r.join('')), palette: Object.assign({}, COMMON, sp.palette) };
  }

  const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

  // Bir olayı (tool_use, hook, kullanıcı komutu) ekip üyesine eşler.
  function attribute(ev) {
    for (const m of TEAM) {
      const r = m.match || {};
      if (ev.kind === 'skill' && r.skill && r.skill.test(ev.name)) return m.id;
      if (ev.kind === 'command' && r.command && r.command.test(ev.text)) return m.id;
      if (ev.kind === 'hook' && r.hookText && r.hookText.test(ev.text || '')) return m.id;
      if (ev.kind === 'agent' && r.agentText && r.agentText.test(ev.text || '')) return m.id;
      if (ev.kind === 'tool' && r.editTools && EDIT_TOOLS.test(ev.name)) return m.id;
    }
    return 'lider';
  }

  const api = { TEAM, spriteGrid, attribute, EDIT_TOOLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EKIP = api;
})(this);
