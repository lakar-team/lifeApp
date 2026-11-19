# Wordhue

Listen to Japanese (computer audio or microphone), show each line with readings, tap a word for its meaning, or translate a whole line word for word. Everything runs in the browser.

## How it is built
- `index.html` – the page and all UI logic.
- `asr-worker.js` – speech recognition in a Web Worker: **ReazonSpeech k2 v2** (Japanese zipformer transducer) run with **sherpa-onnx** WebAssembly (`vendor/sherpa/`). The model (about 160 MB) is downloaded from Hugging Face when the page opens (`?models=<url>` overrides the location, for tests).
- `local-engine.js` – kuromoji tokenizer (`vendor/`) + JMdict (`data/`): readings, meanings, word-for-word translation, both directions.
- `data/build_dict.py` – rebuilds the dictionary files from `jamdict-data`.

## Testing mode
Settings and downloads are not kept between visits, to experience the first run every time. Add `?keep` to the address to keep them.

## Branches
- `main` – this version (ReazonSpeech / sherpa-onnx).
- `whisper-version` – the previous Whisper (transformers.js) version, including the optional Kotoba-Whisper model.
