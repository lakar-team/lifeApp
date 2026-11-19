/* Wordhue smoke test: the same scenarios at desktop, tablet and phone widths.
 * Run:  cd <repo> && npm i --no-save playwright && node tests/wordhue-smoke.cjs [out.json]
 * It serves ./public itself and prints one JSON summary (diff two runs to see what changed).
 * Uses the ?debug test hook of the page; no network or microphone needed. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css", ".gz": "application/gzip", ".txt": "text/plain", ".md": "text/plain" };
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
const SIZES = { desktop: { width: 1100, height: 800 }, tablet: { width: 800, height: 900 }, phone: { width: 390, height: 800 } };

async function scenario(browser, name, vp, port) {
  const out = { size: name }, errs = [];
  const ctx = await browser.newContext({ viewport: vp, colorScheme: "dark", hasTouch: name === "phone" });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/fonts|ERR_|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(`http://localhost:${port}/apps/wordhue/?debug&models=/none/`);
  await p.waitForTimeout(700);
  const hscroll = () => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const words = i => p.$$eval(`.line:nth-of-type(${i}) .tok .ja`, e => e.map(x => x.textContent).join("|"));
  const gl = i => p.$$eval(`.line:nth-of-type(${i}) .tok`, e => e.map(x => x.querySelector(".ja").textContent + "=" + x.querySelector(".gl").textContent).join(" | "));
  const click = sel => name === "phone" ? p.tap(sel) : p.click(sel);

  out.emptyButtons = await p.$$eval(".startopt b", e => e.map(x => x.textContent));
  out.dirLabel = (await p.$eval("#dir", e => e.innerText.trim()));
  // typed Japanese: meanings are shown at once
  await p.fill("#txt", "犬はきびだんごを一つください。"); await click("#send");
  await p.waitForFunction(() => document.querySelectorAll(".line.tr .tok").length > 3, null, { timeout: 60000 }); await p.waitForTimeout(300);
  out.typedJa = await gl(1);
  // heard line: reading first, Translate on demand
  await p.evaluate(() => window.WordhueTest.addReadingLine("猿もきびだんごが好きです。", { dur: 3, t: "00:30", heard: true }));
  await p.waitForFunction(() => document.querySelectorAll(".line:nth-of-type(2) .tok").length > 3, null, { timeout: 30000 });
  out.heardWords = await words(2); out.heardMeaningsHidden = await p.$eval(".line:nth-of-type(2) .gl", e => getComputedStyle(e).display === "none");
  // quick popup
  await click(".line:nth-of-type(2) .tok.tk >> nth=0"); await p.waitForSelector(".qp .qopt, .qp .opt", { timeout: 20000 });
  out.quickPopup = await p.$$eval(".qp .qopt, .qp .opt", e => e.map(x => x.textContent.replace("most common", "").trim()).slice(0, 4));
  // open the full card from the popup
  await click(".qp .qmore"); await p.waitForSelector("#wc");
  await p.waitForFunction(() => document.querySelectorAll("#wc .cand").length > 0, null, { timeout: 30000 }); await p.waitForTimeout(300);
  out.cardPosition = await p.$eval("#wc", e => getComputedStyle(e).position);
  out.cardSections = await p.$$eval("#wc .sec h4", e => e.map(x => x.textContent));
  out.cardCandidates = await p.$$eval("#wc .cand .jp", e => e.map(x => x.textContent));
  out.hscrollWithCard = await hscroll();
  // pick another meaning through the CARD, undo, then through the POPUP: both must behave the same
  const first = await p.$eval(".line:nth-of-type(2) .tok.tk >> nth=0", e => e.querySelector(".gl").textContent).catch(() => "");
  const nOpts = await p.$$eval("#wc .opt", e => e.length);
  if (nOpts > 1) {
    await click("#wc .opt >> nth=1"); await p.waitForTimeout(200);
    out.cardPick = await p.$eval(".line:nth-of-type(2) .tok.tk >> nth=0", e => e.querySelector(".gl").textContent);
    await click("#cUndo"); await p.waitForTimeout(300);
    out.afterUndo = await p.$eval(".line:nth-of-type(2) .tok.tk >> nth=0", e => e.querySelector(".gl").textContent);
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    await click(".line:nth-of-type(2) .tok.tk >> nth=0"); await p.waitForSelector(".qp .qopt, .qp .opt");
    await click(".qp .qopt, .qp .opt >> nth=1"); await p.waitForTimeout(300);
    out.popupPick = await p.$eval(".line:nth-of-type(2) .tok.tk >> nth=0", e => e.querySelector(".gl").textContent);
    out.samePickBothWays = out.cardPick === out.popupPick;
  }
  await p.keyboard.press("Escape");
  // join through the card, then candidates
  const idx = (await p.$$eval(".line:nth-of-type(2) .tok .ja", e => e.map(x => x.textContent))).indexOf("き");
  if (idx >= 0) {
    await click(`.line:nth-of-type(2) .tok.tk >> nth=${idx}`); await p.waitForSelector(".qp .qmore"); await click(".qp .qmore"); await p.waitForSelector("#wc");
    await p.waitForFunction(() => document.querySelectorAll("#wc .cand").length > 0, null, { timeout: 30000 });
    await click('#wc [data-cand="きびだんご"]'); await p.waitForTimeout(900);
    out.afterCandidate = [await words(1), await words(2)];
    await click("#cUndo"); await p.waitForTimeout(500);
    out.afterCandidateUndo = [await words(1), await words(2)];
  }
  await p.keyboard.press("Escape");
  // typed English while the direction is Japanese: prompt, then switch
  await p.fill("#txt", "The old woman washed clothes at the river."); await click("#send"); await p.waitForTimeout(400);
  out.mismatchPrompt = await p.textContent(".toast").catch(() => "");
  await click(".toast button"); await p.waitForFunction(() => document.querySelector("#dirShort") && /EN→日/.test(document.querySelector("#dirShort").textContent), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  out.dirLabelAfter = await p.$eval("#dir", e => e.innerText.trim());
  out.typedEn = await gl(3).catch(() => "");
  out.hscrollEnd = await hscroll();
  out.errors = errs;
  await ctx.close();
  return out;
}
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch(); const results = {};
  for (const [n, vp] of Object.entries(SIZES)) results[n] = await scenario(browser, n, vp, port);
  await browser.close(); server.close();
  const json = JSON.stringify(results, null, 2);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json); else console.log(json);
})().catch(e => { console.error(e); process.exit(1); });
