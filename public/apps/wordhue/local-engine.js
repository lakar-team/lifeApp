/* Wordhue local engine — free, in-browser, word-for-word translation (no server).
 *   JA→EN: kuromoji.js (IPADIC) tokenises → JMdict (data/ja.json) glosses, kept in Japanese order.
 *   EN→JA: simple lemmatiser → reverse JMdict index (data/en.json), kept in English order.
 * Returns the same shapes the page's render() already understands (JA→EN), or {dir:"en"} for EN→JA.
 * Dictionary: JMdict © EDRDG (CC BY-SA 4.0). Tokeniser: kuromoji.js (Apache-2.0) + mecab-ipadic. */
(() => {
  const BASE = new URL(".", document.currentScript ? document.currentScript.src : location.href).href;
  const KANJI = /[一-鿿々]/, KANA = /[぀-ヿ]/;
  const isKana = c => /[぀-ゟ]/.test(c);
  const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

  /* ---------- kana → romaji ---------- */
  const R1 = {あ:"a",い:"i",う:"u",え:"e",お:"o",か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
    た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
    ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",や:"ya",ゆ:"yu",よ:"yo",ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",わ:"wa",ゐ:"i",ゑ:"e",を:"o",ん:"n",
    が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
    ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",ゔ:"vu",ぁ:"a",ぃ:"i",ぅ:"u",ぇ:"e",ぉ:"o"};
  const R2 = {きゃ:"kya",きゅ:"kyu",きょ:"kyo",しゃ:"sha",しゅ:"shu",しょ:"sho",ちゃ:"cha",ちゅ:"chu",ちょ:"cho",にゃ:"nya",にゅ:"nyu",にょ:"nyo",
    ひゃ:"hya",ひゅ:"hyu",ひょ:"hyo",みゃ:"mya",みゅ:"myu",みょ:"myo",りゃ:"rya",りゅ:"ryu",りょ:"ryo",ぎゃ:"gya",ぎゅ:"gyu",ぎょ:"gyo",
    じゃ:"ja",じゅ:"ju",じょ:"jo",びゃ:"bya",びゅ:"byu",びょ:"byo",ぴゃ:"pya",ぴゅ:"pyu",ぴょ:"pyo",ふぁ:"fa",ふぃ:"fi",ふぇ:"fe",ふぉ:"fo",
    てぃ:"ti",でぃ:"di",うぃ:"wi",うぇ:"we",うぉ:"wo",ゔぁ:"va",ゔぃ:"vi",ゔぇ:"ve",ゔぉ:"vo",じぇ:"je",しぇ:"she",ちぇ:"che"};
  function romaji(kana) {
    const h = toHira(kana); let out = "";
    for (let i = 0; i < h.length; i++) {
      const c = h[i], two = h.slice(i, i + 2);
      if (c === "っ") { const nx = R2[h.slice(i+1,i+3)] || R1[h[i+1]] || ""; out += nx ? (nx[0] === "c" ? "t" : nx[0]) : "t"; continue; }
      if (c === "ー") { out += out.slice(-1) || ""; continue; }
      if (R2[two]) { out += R2[two]; i++; continue; }
      out += R1[c] !== undefined ? R1[c] : c;
    }
    return out;
  }

  /* ---------- helpers ---------- */
  function furi(surface, reading) {            // ruby only over the kanji part
    const hira = toHira(reading || "");
    if (!KANJI.test(surface) || !hira) return [[surface, null]];
    let i = surface.length, j = hira.length;
    while (i > 0 && j > 0 && isKana(surface[i-1]) && surface[i-1] === hira[j-1]) { i--; j--; }
    if (i === surface.length) return [[surface, hira]];
    if (i === 0 || j === 0) return [[surface, hira]];
    return [[surface.slice(0, i), hira.slice(0, j)], [surface.slice(i), null]];
  }
  const shortGloss = g => {
    let s = (g || "").split("|")[0];
    for (let n = 0; n < 4 && /\([^()]*\)/.test(s); n++) s = s.replace(/\s*\([^()]*\)/g, "");
    s = s.replace(/\s*\(.*$/, "").replace(/\)/g, "").split("; ")[0].replace(/^to /, "").trim();
    return s || (g || "").split(" | ")[0];
  };

  /* ---------- Japanese function words ---------- */
  const PARTICLE = {は:"[topic]",が:"[subj]",を:"[obj]",に:"[to/at]",へ:"[toward]",で:"[at/by]",の:"[of]",と:"[and/with]",も:"[also]",から:"[from]",まで:"[until]",
    や:"[and]",か:"[?]",ね:"[ne]",よ:"[yo]",な:"[!]",ぞ:"[!]",わ:"[wa]",ば:"[if]",ので:"[because]",のに:"[although]",けど:"[but]",けれど:"[but]",けれども:"[but]",
    が_conj:"[but]",し:"[and]",て:"[and]",で_te:"[and]",より:"[than]",だけ:"[only]",しか:"[only]",ばかり:"[only]",など:"[etc.]",なら:"[if]",ながら:"[while]",
    たり:"[and/or]",って:"[quote]",こそ:"[indeed]",さえ:"[even]",でも:"[even]",ほど:"[extent]",くらい:"[about]",ぐらい:"[about]",とか:"[and]",ず:"[not]"};
  const AUX = {ます:"[polite]",まし:"[polite]",ませ:"[polite]",です:"[is]",でし:"[is]",だ:"[is]",だっ:"[is]",た:"[past]",だ_past:"[past]",
    ない:"[not]",ぬ:"[not]",ん:"[not]",なかっ:"[not]",たい:"[want]",たかっ:"[want]",れる:"[passive]",られる:"[passive]",れ:"[passive]",られ:"[passive]",
    せる:"[cause]",させる:"[cause]",せ:"[cause]",させ:"[cause]",う:"[let's]",よう:"[let's]",まい:"[won't]",らしい:"[seems]",そう:"[looks]",ようだ:"[like]",
    べき:"[should]",たら:"[if]",なさい:"[do!]",ちゃう:"[completely]"};
  const NONINDEP = {いる:"[-ing]",い:"[-ing]",おる:"[-ing]",くる:"(come)",き:"(come)",こ:"(come)",くれる:"(for me)",くれ:"(for me)",あげる:"(for you)",あげ:"(for you)",
    しまう:"(completely)",しまっ:"(completely)",みる:"(try)",み:"(try)",おく:"(in advance)",おい:"(in advance)",いく:"(go on)",いっ:"(go on)",
    もらう:"(receive)",もらっ:"(receive)",ください:"(please)",くださる:"(please)",くださっ:"(please)",ある:"[exists]",あっ:"[exists]",
    ほしい:"(want)",やる:"(do for)",すぎる:"(too much)",すぎ:"(too much)",なる:"(become)",なっ:"(become)"};
  const VERB_FIX = {する:"do",し:"do",いる:"be (alive)",ある:"be/exist",なる:"become",くる:"come",行く:"go",言う:"say",見る:"see",
    思う:"think",知る:"know",できる:"can do",分かる:"understand",わかる:"understand",ない:"not",居る:"be (alive)",有る:"be/exist",
    私:"I",僕:"I",俺:"I",あなた:"you",彼:"he",彼女:"she",これ:"this",それ:"that",あれ:"that (far)",ここ:"here",そこ:"there",どこ:"where",
    何:"what",誰:"who",いつ:"when",なぜ:"why",どう:"how",この:"this",その:"that",あの:"that (far)",ある_det:"a certain",こと:"thing/matter",
    もの:"thing",の_nom:"(nominaliser)",みんな:"everyone",とても:"very",もう:"already",まだ:"still",すぐ:"soon",よく:"often/well"};
  const CLS = {名詞:"noun",代名詞:"pron",動詞:"verb",形容詞:"adj",形容動詞:"adj",副詞:"adv",連体詞:"det",接続詞:"particle",助詞:"particle",助動詞:"aux",
    記号:"punct",感動詞:"other",フィラー:"other",接頭詞:"other",その他:"other"};

  /* ---------- loaders ---------- */
  let tokP = null, jaP = null, enP = null;
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("could not load " + src)); document.head.appendChild(s); });
  const getTok = () => tokP || (tokP = (async () => {
    if (!window.kuromoji) await loadScript(BASE + "vendor/kuromoji.js");
    return new Promise((ok, no) => window.kuromoji.builder({ dicPath: new URL("vendor/dict/", BASE).pathname }).build((e, t) => e ? no(e) : ok(t)));
  })().catch(e => { tokP = null; throw e; }));
  const getJa = () => jaP || (jaP = fetch(BASE + "data/ja.json").then(r => { if (!r.ok) throw new Error("ja.json " + r.status); return r.json(); }).then(j => j.w).catch(e => { jaP = null; throw e; }));
  const getEn = () => enP || (enP = fetch(BASE + "data/en.json").then(r => { if (!r.ok) throw new Error("en.json " + r.status); return r.json(); }).then(j => j.r).catch(e => { enP = null; throw e; }));

  /* ================= Japanese → English ================= */
  function splitSentences(text) {
    const out = []; let cur = "";
    for (const ch of text.replace(/\r/g, "")) {
      cur += ch;
      if ("。！？!?\n".includes(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /* --- conversation context: what the last few sentences were about --- */
  const ENSTOP = new Set("a an the of to in on at by for with and or is are was were be been it its this that these those i you he she we they me my your his her not no as from into than then so do does did have has had will would can could should may might must".split(" "));
  const conv = { sents: [], max: 6 };
  const ctxWords = () => { const m = new Map(); conv.sents.forEach((s, i) => s.words.forEach(w => m.set(w, (m.get(w) || 0) + 1 + i * 0.1))); return m; };
  const ctxFields = () => { const m = new Map(); conv.sents.forEach(s => s.fields.forEach(f => m.set(f, (m.get(f) || 0) + 1))); return m; };
  const gwords = g => (g.replace(/\([^)]*\)?/g, " ").toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !ENSTOP.has(w));

  /* --- sense selection: part of speech + position + conversation/sentence topic --- */
  const SPECIAL = new Set(["comp", "sumo", "mil", "bud", "baseball", "astro", "anat", "chem", "phys", "ling", "math", "med", "law", "fin", "econ", "bio", "music", "sport", "food"]);
  function wantedPos(k) {
    const p = k.pos, d = k.pos_detail_1, ct = k.conjugated_type || "";
    if (p === "動詞") return [/一段/.test(ct) ? "v1" : /五段/.test(ct) ? "v5" : /サ変/.test(ct) ? "vs" : /カ変/.test(ct) ? "vk" : "v1", "v5", "vi", "vt", "vs", "aux"];
    if (p === "名詞") return d === "サ変接続" ? ["n", "vs"] : d === "形容動詞語幹" ? ["adj-na", "n"] : d === "代名詞" ? ["pn", "n"] : d === "副詞可能" ? ["n", "adv"] : d === "接尾" ? ["suf", "ctr", "n"] : d === "数" ? ["num", "n", "ctr"] : ["n"];
    if (p === "形容詞") return ["adj-i"]; if (p === "副詞") return ["adv"]; if (p === "連体詞") return ["adj-pn", "adj-no"];
    if (p === "接続詞") return ["conj"]; if (p === "感動詞") return ["int", "exp"]; if (p === "代名詞") return ["pn"];
    return [];
  }
  function parseEntry(e) {
    const g = e[0].split("|"), ps = (e[1] || "").split("|"), fs = (e[2] || "").split("|"), rs = (e[3] || "").split("|");
    return g.map((x, i) => ({ g: x, pos: (ps[i] || "").split(",").filter(Boolean), f: fs[i] || "", r: rs[i] || "" }));
  }
  function rankSenses(e, k, words, fields) {
    const want = wantedPos(k), senses = parseEntry(e), rd = k.reading && k.reading !== "*" ? toHira(k.reading) : "";
    return senses.map((s, i) => {
      let sc = -0.35 * i;
      if (rd && s.r) {                                    // reading must fit (本 = ほん, not もと)
        const infl = k.pos === "動詞" || k.pos === "形容詞", n = infl ? Math.max(1, Math.min(rd.length, s.r.length) - 2) : 99;
        sc += (infl ? s.r.slice(0, n) === rd.slice(0, n) : s.r === rd) ? 3 : -1;
      }
      if (want.length) {
        if (s.pos.includes(want[0])) sc += 4;
        else if (want.slice(1).some(w => s.pos.includes(w))) sc += 2;
        if (k.pos === "動詞" && !s.pos.some(p => /^v|aux/.test(p))) sc -= 3;
        if (k.pos === "名詞" && s.pos.length && !s.pos.some(p => /^(n|vs|adj-na|pn|num|suf|ctr|adv)$/.test(p))) sc -= 2;
      }
      let ov = 0; for (const w of gwords(s.g)) if (words.has(w)) ov += Math.min(2, words.get(w)); sc += Math.min(3, ov * 1.5);
      if (s.f) sc += fields.has(s.f) ? 2 + Math.min(2, fields.get(s.f) * 0.5) : (SPECIAL.has(s.f) ? -1.5 : 0);
      return { ...s, sc };
    }).sort((a, b) => b.sc - a.sc);
  }

  /* --- small neighbour rules for particles (the main source of "wrong" glosses) --- */
  const MOTION = new Set("行く 来る 帰る 戻る 入る 着く 向かう 出かける 通う 引っ越す 登る 上がる 降りる 出る 走る 歩く 飛ぶ 渡る 参る".split(" "));
  const RECIP = new Set("会う 話す 言う 頼む 教える あげる やる くれる 貸す 送る 見せる 渡す 電話する 話しかける 答える 質問する".split(" "));
  const SOURCE = new Set("もらう 借りる 習う 聞く 買う 教わる".split(" "));
  const QUOTE = new Set("言う 思う 聞く 書く 話す 答える 叫ぶ 呼ぶ 信じる 考える 感じる 決める 知る 約束する".split(" "));
  const VEHICLE = /^(電車|バス|車|タクシー|飛行機|船|自転車|徒歩|歩き|新幹線|地下鉄|バイク|手|箸|ペン|鉛筆|筆|スマホ|電話|メール|日本語|英語|現金|カード|ナイフ|包丁|道具|機械|目|耳|口|足|力|言葉)$/;
  const CAUSE = /^(雨|病気|風邪|事故|地震|火事|台風|雪|風|怪我|仕事|用事|忙しさ|疲れ|寒さ|暑さ|熱|頭痛|寝不足)$/;
  const GROUP = /^(.*人|みんな|皆|二人|三人|家族|友達|一人|自分)$/;
  const TIMEN = /^(今日|明日|昨日|今|朝|昼|夜|夕方|毎日|毎朝|毎晩|去年|今年|来年|来週|先週|今週|来月|先月|今月|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日|時|時間|分|日|年|月|週|春|夏|秋|冬|午前|午後|昔|今度|この前|最近)$/;
  const STATEV = new Set("知る 住む 持つ 着る 履く 立つ 座る 結婚する 似る 働く 勤める 乗る 覚える 分かる".split(" "));
  const QWORD = new Set("何 誰 どこ いつ どれ どちら いくつ どう 何か".split(" "));
  const NEGA = new Set(["ない", "ぬ", "ん", "なかっ", "ませ"]);

  function particleGloss(raw, i) {
    const k = raw[i], surf = k.surface_form, d1 = k.pos_detail_1;
    const prev = raw[i - 1], next = raw[i + 1];
    const verbAfter = () => { for (let j = i + 1; j < Math.min(raw.length, i + 5); j++) { const t = raw[j]; if (t.pos === "動詞" && t.pos_detail_1 !== "非自立") return t.basic_form; if (t.surface_form === "、" || t.surface_form === "。") break; } return null; };
    const clauseHas = (re) => { for (let j = i + 1; j < raw.length; j++) { const t = raw[j]; if (t.surface_form === "、" || t.surface_form === "。") break; if (re.test(t.basic_form || t.surface_form)) return true; } return false; };
    const clauseNeg = () => { for (let j = i + 1; j < raw.length; j++) { const t = raw[j]; if (t.surface_form === "、" || t.surface_form === "。") break; if (NEGA.has(t.surface_form) || NEGA.has(t.basic_form)) return true; } return false; };
    const prevIsVerbal = prev && (prev.pos === "動詞" || prev.pos === "助動詞" || prev.pos === "形容詞");
    switch (surf) {
      case "に": {
        const v = verbAfter(), pn = prev && prev.surface_form;
        if (next && /^(れ|られ)/.test(next.surface_form) && next.pos === "動詞") return "[by]";
        if (v && next && (next.pos === "動詞") && prevIsVerbal) return "[in order to]";
        if (prev && (prev.pos_detail_1 === "副詞可能" || prev.pos_detail_1 === "数" || TIMEN.test(pn))) return "[at]";
        if (v && MOTION.has(v)) return "[to]";
        if (v && SOURCE.has(v)) return "[from]";
        if (v && RECIP.has(v)) return "[to]";
        if (v === "会う") return "[with]";
        if (prev && prev.pos_detail_1 === "固有名詞") return "[to/at]";
        return "[at/to]";
      }
      case "で": {
        if (k.pos === "助動詞") return "[being]";
        if (d1 === "接続助詞") return "[and]";
        const pn = prev && prev.surface_form;
        if (pn && CAUSE.test(pn)) return "[due to]";
        if (pn && VEHICLE.test(pn)) return "[by/with]";
        if (pn && GROUP.test(pn)) return "[as a group]";
        return "[at/in]";
      }
      case "と": {
        if (d1 === "接続助詞") return "[when/if]";
        const v = verbAfter();
        if (v && QUOTE.has(v)) return "[quote]";
        if (prevIsVerbal) return "[when/if]";
        if (next && /^(一緒|ともに|共に)/.test(next.surface_form)) return "[with]";
        if (prev && prev.pos === "名詞" && next && (next.pos === "名詞" || next.pos === "代名詞")) return "[and]";
        return "[with/and]";
      }
      case "の": {
        if (d1 === "終助詞") return "[?]";
        if (next && (next.surface_form === "は" || next.surface_form === "が" || next.surface_form === "を" || next.surface_form === "に" || next.surface_form === "で") && prevIsVerbal) return "[nom.]";
        if (prevIsVerbal && next && next.pos === "名詞") return "[that/’s]";
        if (!next || next.surface_form === "。" || next.surface_form === "か") return "[expl.]";
        return "[of]";
      }
      case "が": {
        if (d1 === "接続助詞") return "[but]";
        if (clauseHas(/^(好き|嫌い|欲しい|ほしい|できる|分かる|わかる|上手|下手|見える|聞こえる|要る|必要)$/)) return "[obj]";
        return "[subj]";
      }
      case "は": return prev && prev.pos === "助詞" && prev.pos_detail_1 !== "終助詞" ? "[as for]" : "[topic]";
      case "も": return prev && QWORD.has(prev.surface_form) ? "[any]" : "[also]";
      case "て": return "[and]";
      case "へ": return "[toward]";
    }
    return null;
  }

  async function ja2en(text, onStatus, opts) {
    onStatus && onStatus("loading Japanese dictionary (first time only, ~20 MB)…");
    const [tok, dict] = await Promise.all([getTok(), getJa()]);
    const t0 = performance.now();
    const keep = !(opts && opts.noContext);
    const sentences = splitSentences(text).map(sent => {
      const raw = tok.tokenize(sent);
      const info = raw.map(k => ({ k, base: k.basic_form && k.basic_form !== "*" ? k.basic_form : k.surface_form, e: null }));
      info.forEach(o => { o.e = dict[o.base] || dict[o.k.surface_form] || null; });
      // pass A: context from earlier sentences only → rough topic of this sentence
      const cw = ctxWords(), cf = ctxFields();
      const bag = new Map(cw), fbag = new Map(cf);
      info.forEach(o => { if (o.e && VERB_FIX[o.base] === undefined && !FUNC(o.k)) { const r = rankSenses(o.e, o.k, cw, cf)[0]; gwords(r.g).forEach(w => bag.set(w, (bag.get(w) || 0) + 1)); if (r.f) fbag.set(r.f, (fbag.get(r.f) || 0) + 1); } });
      // pass B: pick senses with the sentence + conversation topic
      const tokens = [], literal = [], english = [], romajiRow = [], warnings = [], alts = [];
      const usedWords = [], usedFields = [];
      let known = 0, content = 0;
      raw.forEach((k, i) => {
        const surf = k.surface_form, pos = k.pos, d1 = k.pos_detail_1;
        const base = info[i].base;
        const reading = k.reading && k.reading !== "*" ? k.reading : surf;
        let cls = CLS[pos] || "other", gloss = null, tag = false, alt = null;
        if (d1 === "固有名詞") cls = "propn";
        if (pos === "助詞") {
          gloss = particleGloss(raw, i) || PARTICLE[surf] || null; tag = true;
        } else if (pos === "助動詞") {
          gloss = particleGloss(raw, i) || AUX[surf] || AUX[base] || null; tag = true;
        } else if (base === "なさる" || base === "なさい") {
          gloss = "[do!]"; tag = true;
        } else if (pos === "動詞" && d1 === "非自立") {
          gloss = NONINDEP[base] || NONINDEP[surf] || null; tag = !!gloss;
          if ((base === "いる" || base === "おる") && raw[i - 1] && raw[i - 2] && STATEV.has(raw[i - 2].basic_form)) gloss = "[state]";
        } else if (pos === "名詞" && (d1 === "非自立" || d1 === "接尾")) {
          gloss = base === "の" ? "[nom.]" : base === "こと" ? "(thing)" : base === "もの" ? "(thing)" : base === "ん" ? "[nom.]" : null;
          tag = !!gloss;
        } else if (pos === "記号") {
          gloss = surf; tag = true;
        }
        if (pos === "連体詞" && base === "ある") { gloss = "a certain"; known++; content++; }
        if (gloss === null) {
          content++;
          const e = info[i].e;
          if (VERB_FIX[base] !== undefined && pos !== "連体詞") { gloss = VERB_FIX[base]; known++; }
          else if (e) {
            const ranked = rankSenses(e, k, bag, fbag);
            gloss = shortGloss(ranked[0].g); known++;
            usedWords.push(...gwords(ranked[0].g)); if (ranked[0].f) usedFields.push(ranked[0].f);
            const seen = new Set([gloss]); alt = [];
            ranked.forEach(r => { const g = shortGloss(r.g); if (!seen.has(g)) { seen.add(g); alt.push(g); } });
            if (!alt.length) alt = null; else alt.unshift(gloss);
          } else if (d1 === "固有名詞") {
            gloss = "[" + romaji(reading) + "]"; warnings.push(`“${surf}” is not in the dictionary — shown as romaji`);
          } else if (KANJI.test(surf) || KANA.test(surf)) {
            gloss = "[" + romaji(reading) + "]"; warnings.push(`“${surf}” not found — shown as romaji`);
          } else { gloss = surf; known++; }
          if (cls === "noun" && d1 === "副詞可能") cls = "adv";
        }
        const furiSegs = furi(surf, reading);
        let rm = romaji(reading);
        if (pos === "助詞" && surf === "は") rm = "wa";
        if (pos === "助詞" && surf === "を") rm = "o";
        if (pos === "助詞" && surf === "へ") rm = "e";
        if (pos === "記号") rm = surf;
        tokens.push({ kana: toHira(reading), romaji: rm, furi: furiSegs, id: i, text: surf, te: false, reading, lemma: base, pos, tag: pos + "-" + d1, dep: "", head: 0, cls });
        romajiRow.push({ text: rm, ids: [i], parts: [{ text: rm, ids: [i], cls }] });
        literal.push({ text: gloss, ids: [i], cls });
        alts.push(alt);
        if (!(tag && /^[\[(]/.test(gloss))) english.push({ text: gloss, ids: [i], cls, inserted: false });
        else if (pos === "記号") english.push({ text: gloss, ids: [i], cls: "punct", inserted: false });
      });
      if (keep) { conv.sents.push({ words: usedWords, fields: usedFields }); if (conv.sents.length > conv.max) conv.sents.shift(); }
      const conf = content ? known / content : 1;
      return { romaji: romajiRow, tokens, literal, english, alts, confidence: Math.round(conf * 100) / 100, warnings: [...new Set(warnings)] };
    });
    return { input: text, normalized: text, sentences, ms: Math.round(performance.now() - t0),
      credits: "Dictionary: JMdict (c) EDRDG, CC BY-SA 4.0. Tokenizer: kuromoji.js + mecab-ipadic.", english_text: "" };
  }
  const FUNC = k => k.pos === "助詞" || k.pos === "助動詞" || k.pos === "記号" || (k.pos === "動詞" && k.pos_detail_1 === "非自立") || (k.pos === "名詞" && (k.pos_detail_1 === "非自立" || k.pos_detail_1 === "接尾"));

  const context = () => {
    const w = ctxWords(), f = ctxFields();
    return { sentences: conv.sents.length, words: [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]), fields: [...f.keys()] };
  };
  const resetContext = () => { conv.sents.length = 0; };

  /* ================= English → Japanese ================= */
  const EN_FIX = {i:["私","わたし"],me:["私","わたし"],my:["私の","わたしの"],you:["あなた","あなた"],your:["あなたの","あなたの"],he:["彼","かれ"],him:["彼","かれ"],his:["彼の","かれの"],
    she:["彼女","かのじょ"],her:["彼女","かのじょ"],we:["私たち","わたしたち"],us:["私たち","わたしたち"],they:["彼ら","かれら"],them:["彼ら","かれら"],it:["それ","それ"],
    this:["これ","これ"],that:["それ","それ"],these:["これら","これら"],those:["それら","それら"],here:["ここ","ここ"],there:["そこ","そこ"],
    is:["です","です"],am:["です","です"],are:["です","です"],be:["です","です"],was:["でした","でした"],were:["でした","でした"],been:["でした","でした"],
    do:["する","する"],does:["する","する"],did:["した","した"],not:["ない","ない"],no:["いいえ","いいえ"],yes:["はい","はい"],
    and:["と","と"],or:["または","または"],but:["しかし","しかし"],if:["もし","もし"],because:["なぜなら","なぜなら"],so:["だから","だから"],
    of:["の","の"],to:["へ","へ"],in:["で","で"],on:["に","に"],at:["で","で"],with:["と","と"],from:["から","から"],for:["のために","のために"],by:["で","で"],
    what:["何","なに"],who:["誰","だれ"],when:["いつ","いつ"],where:["どこ","どこ"],why:["なぜ","なぜ"],how:["どう","どう"],which:["どれ","どれ"],
    can:["できる","できる"],will:["でしょう","でしょう"],would:["でしょう","でしょう"],must:["なければならない","なければならない"],
    very:["とても","とても"],also:["も","も"],all:["全部","ぜんぶ"],every:["毎","まい"],some:["いくつか","いくつか"],many:["たくさん","たくさん"],
    have:["持つ","もつ"],has:["持つ","もつ"],had:["持った","もった"],go:["行く","いく"],went:["行った","いった"],gone:["行った","いった"],
    come:["来る","くる"],came:["来た","きた"],eat:["食べる","たべる"],ate:["食べた","たべた"],see:["見る","みる"],saw:["見た","みた"],seen:["見た","みた"],
    say:["言う","いう"],said:["言った","いった"],make:["作る","つくる"],made:["作った","つくった"],take:["取る","とる"],took:["取った","とった"],
    give:["与える","あたえる"],gave:["与えた","あたえた"],know:["知る","しる"],knew:["知った","しった"],think:["思う","おもう"],thought:["思った","おもった"],
    get:["得る","える"],got:["得た","えた"],buy:["買う","かう"],bought:["買った","かった"],read:["読む","よむ"],write:["書く","かく"],wrote:["書いた","かいた"],
    people:["人々","ひとびと"],children:["子供たち","こどもたち"],men:["男たち","おとこたち"],women:["女たち","おんなたち"]};
  const STOP = new Set(["the", "a", "an"]);
  function lemmas(w) {
    const c = [w];
    if (w.endsWith("ies")) c.push(w.slice(0, -3) + "y");
    if (w.endsWith("es")) c.push(w.slice(0, -2));
    if (w.endsWith("s")) c.push(w.slice(0, -1));
    if (w.endsWith("ing")) { const b = w.slice(0, -3); c.push(b, b + "e"); if (b.length > 2 && b.at(-1) === b.at(-2)) c.push(b.slice(0, -1)); }
    if (w.endsWith("ed")) { const b = w.slice(0, -2); c.push(b, b + "e", w.slice(0, -1)); if (b.length > 2 && b.at(-1) === b.at(-2)) c.push(b.slice(0, -1)); if (w.endsWith("ied")) c.push(w.slice(0, -3) + "y"); }
    if (w.endsWith("er")) c.push(w.slice(0, -2), w.slice(0, -1));
    if (w.endsWith("est")) c.push(w.slice(0, -3), w.slice(0, -2));
    if (w.endsWith("ly")) c.push(w.slice(0, -2));
    return c;
  }
  async function en2ja(text, onStatus) {
    onStatus && onStatus("loading English → Japanese dictionary (first time only)…");
    const rev = await getEn();
    const t0 = performance.now();
    const sents = (text.match(/[^.!?\n]+[.!?]*/g) || [text]).map(s => s.trim()).filter(Boolean);
    const sentences = sents.map(sent => {
      const words = sent.match(/[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[^\sA-Za-z\d]/g) || [];
      const src = [], jp = [], warnings = [];
      let known = 0, content = 0;
      words.forEach((w, i) => {
        const lw = w.toLowerCase().replace(/'s$/, "");
        const isWord = /[A-Za-z]/.test(w);
        if (!isWord) { src.push({ text: w, id: i, cls: "punct" }); jp.push({ id: i, text: /[.]/.test(w) ? "。" : w === "," ? "、" : w, kana: "", romaji: w, furi: [[w, null]], cls: "punct", alts: [] }); return; }
        if (STOP.has(lw)) { src.push({ text: w, id: i, cls: "det" }); return; }   // no Japanese counterpart
        let hit = null, alts = [];
        if (EN_FIX[lw]) hit = EN_FIX[lw];
        else for (const l of lemmas(lw)) { if (rev[l]) { hit = rev[l][0]; alts = rev[l].slice(1); break; } }
        const fn = !!EN_FIX[lw];
        if (!fn) content++;
        if (hit) { if (!fn) known++; }
        else warnings.push(`“${w}” not found`);
        const cap = /^[A-Z]/.test(w) && i > 0;
        src.push({ text: w, id: i, cls: hit ? (fn ? "particle" : "noun") : (cap ? "propn" : "other") });
        if (hit) jp.push({ id: i, text: hit[0], kana: hit[1], romaji: romaji(hit[1]), furi: furi(hit[0], hit[1]), cls: fn ? "particle" : "noun", alts });
        else jp.push({ id: i, text: "[" + w + "]", kana: "", romaji: w, furi: [["[" + w + "]", null]], cls: "propn", alts: [] });
      });
      return { src, jp, confidence: Math.round((content ? known / content : 1) * 100) / 100, warnings: [...new Set(warnings)] };
    });
    return { dir: "en", input: text, sentences, ms: Math.round(performance.now() - t0) };
  }

  window.WordhueLocal = {
    ja2en, en2ja, romaji, furi, context, resetContext,
    detect: t => (KANJI.test(t) || KANA.test(t)) ? "ja" : "en",
    warm: () => Promise.all([getTok(), getJa()])
  };
})();
