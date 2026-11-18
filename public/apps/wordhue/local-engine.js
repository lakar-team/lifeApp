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
    let s = (g || "").split(" | ")[0].split("; ")[0];
    s = s.replace(/\s*\([^)]*\)/g, "").replace(/^to /, "").trim();
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

  async function ja2en(text, onStatus) {
    onStatus && onStatus("loading Japanese dictionary (first time only, ~20 MB)…");
    const [tok, dict] = await Promise.all([getTok(), getJa()]);
    const t0 = performance.now();
    const sentences = splitSentences(text).map(sent => {
      const raw = tok.tokenize(sent);
      const tokens = [], literal = [], english = [], romajiRow = [], warnings = [];
      let known = 0, content = 0;
      raw.forEach((k, i) => {
        const surf = k.surface_form, pos = k.pos, d1 = k.pos_detail_1;
        const base = k.basic_form && k.basic_form !== "*" ? k.basic_form : surf;
        const reading = k.reading && k.reading !== "*" ? k.reading : surf;
        let cls = CLS[pos] || "other", gloss = null, tag = false;
        if (d1 === "固有名詞") cls = "propn";
        if (pos === "助詞") {
          gloss = PARTICLE[surf] || null; tag = true;
          if (d1 === "接続助詞" && (surf === "て" || surf === "で")) gloss = "[and]";
          if (d1 === "接続助詞" && surf === "が") gloss = "[but]";
          if (d1 === "格助詞" && surf === "と") gloss = "[with/quote]";
        } else if (pos === "助動詞") {
          gloss = AUX[surf] || AUX[base] || null; tag = true;
        } else if (base === "なさる" || base === "なさい") {
          gloss = "[do!]"; tag = true;
        } else if (pos === "動詞" && d1 === "非自立") {
          gloss = NONINDEP[base] || NONINDEP[surf] || null; tag = !!gloss;
        } else if (pos === "名詞" && (d1 === "非自立" || d1 === "接尾")) {
          gloss = base === "の" ? "[nom.]" : base === "こと" ? "(thing)" : base === "もの" ? "(thing)" : base === "ん" ? "[nom.]" : null;
          tag = !!gloss;
        } else if (pos === "記号") {
          gloss = surf; tag = true;
        } else if (d1 === "固有名詞") {
          const e = dict[surf] || dict[base];
          gloss = e ? shortGloss(e[0]) : "[" + romaji(reading) + "]"; // unknown name → romaji
          if (e) known++; content++; if (!e) warnings.push(`“${surf}” is not in the dictionary — shown as romaji`);
        }
        if (pos === "連体詞" && base === "ある") { gloss = "a certain"; known++; content++; }
        if (gloss === null) {
          // content word: dictionary lookup, base form first
          content++;
          const e = VERB_FIX[base] !== undefined ? [VERB_FIX[base]] : (dict[base] || dict[surf]);
          if (e) { gloss = VERB_FIX[base] !== undefined ? VERB_FIX[base] : shortGloss(e[0]); known++; }
          else if (KANJI.test(surf) || KANA.test(surf)) {
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
        // the "English" row = same words without grammar tags / punctuation spacing
        if (!(tag && /^[\[(]/.test(gloss))) english.push({ text: gloss, ids: [i], cls, inserted: false });
        else if (pos === "記号") english.push({ text: gloss, ids: [i], cls: "punct", inserted: false });
      });
      const conf = content ? known / content : 1;
      return { romaji: romajiRow, tokens, literal, english, confidence: Math.round(conf * 100) / 100, warnings: [...new Set(warnings)] };
    });
    return { input: text, normalized: text, sentences, ms: Math.round(performance.now() - t0),
      credits: "Dictionary: JMdict (c) EDRDG, CC BY-SA 4.0. Tokenizer: kuromoji.js + mecab-ipadic.", english_text: "" };
  }

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
    ja2en, en2ja, romaji, furi,
    detect: t => (KANJI.test(t) || KANA.test(t)) ? "ja" : "en",
    warm: () => Promise.all([getTok(), getJa()])
  };
})();
