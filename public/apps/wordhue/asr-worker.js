/* Speech recognition worker for Wordhue.
 * Japanese speech → text with the ReazonSpeech zipformer model, running in WebAssembly (sherpa-onnx) off the main thread.
 * Cost grows with the length of the audio, with no fixed 30 s window.
 * Messages in:  {type:"init", base, vendor, fresh}   {type:"decode", id, samples:Float32Array}
 * Messages out: {type:"progress", frac}  {type:"ready"}  {type:"result", id, text, ms}  {type:"error", id?, message}
 */
const FILES = {            // name → bytes (for the progress bar when the server hides content-length)
  "encoder-epoch-99-avg-1.int8.onnx": 154670139,
  "decoder-epoch-99-avg-1.int8.onnx": 2959337,
  "joiner-epoch-99-avg-1.int8.onnx": 2696970,
  "tokens.txt": 45754
};
let mod = null, rec = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") await init(m);
    else if (m.type === "decode") {
      const t0 = performance.now(), stream = rec.createStream();
      stream.acceptWaveform(16000, m.samples);
      rec.decode(stream);
      const r = rec.getResult(stream); stream.free();
      self.postMessage({ type: "result", id: m.id, text: (r.text || "").trim(), ms: performance.now() - t0 });
    }
  } catch (err) { self.postMessage({ type: "error", id: m.id, message: String(err && err.message || err) }); }
};

async function init({ base, vendor, fresh }) {
  const ready = new Promise(res => {
    self.Module = { locateFile: p => vendor + p, getPreloadedPackage: () => new ArrayBuffer(1), onRuntimeInitialized: res, print: () => {}, printErr: () => {} };
  });
  importScripts(vendor + "sherpa-onnx-wasm-main-vad-asr.js");      // the WebAssembly runtime (browser build)
  importScripts(vendor + "sherpa-onnx-asr.js");                    // its JavaScript wrapper (defines OfflineRecognizer)
  await ready; mod = self.Module;

  const total = Object.values(FILES).reduce((a, b) => a + b, 0); let done = 0;
  for (const [name, size] of Object.entries(FILES)) {
    const res = await fetch(base + name, fresh ? { cache: "no-store" } : {});
    if (!res.ok) throw new Error("model download failed (" + res.status + "): " + name);
    let buf = new Uint8Array(size), got = 0;                              // sized from the known file size; grows if the file is bigger
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read(); if (end) break;
      if (got + value.length > buf.length) { const bigger = new Uint8Array(Math.max(buf.length * 2, got + value.length)); bigger.set(buf.subarray(0, got)); buf = bigger; }
      buf.set(value, got); got += value.length; done += value.length;
      self.postMessage({ type: "progress", frac: Math.min(0.99, done / total) });
    }
    mod.FS_createDataFile("/", name, got === buf.length ? buf : buf.subarray(0, got), true, false, true);   // owned: no extra copy
    buf = null;
  }
  rec = new OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: "/encoder-epoch-99-avg-1.int8.onnx", decoder: "/decoder-epoch-99-avg-1.int8.onnx", joiner: "/joiner-epoch-99-avg-1.int8.onnx" },
      tokens: "/tokens.txt", numThreads: 1, provider: "cpu", debug: 0, modelType: "transducer"
    }
  }, mod);
  self.postMessage({ type: "ready" });
}
