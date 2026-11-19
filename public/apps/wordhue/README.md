# Wordhue

Listen to Japanese (computer audio or microphone), show each line with readings, tap a word for its meaning, or translate a whole line word for word. Everything runs in the browser.

## How it is built
- `index.html` – the page and all UI logic.
- `asr-worker.js` – speech recognition in a Web Worker: **ReazonSpeech k2 v2** (Japanese zipformer transducer) run with **sherpa-onnx** WebAssembly (`vendor/sherpa/`). The model (about 160 MB) is downloaded from Hugging Face when the page opens (`?models=<url>` overrides the location, for tests).
- `local-engine.js` – kuromoji tokenizer (`vendor/`) + JMdict (`data/`): readings, meanings, word-for-word translation, both directions.
- `data/build_dict.py` – rebuilds the dictionary files from `jamdict-data`: `ja.json` (common words, loaded at start), `ja-extra-0..2.json` (rarer words and names, about 23 MB, loaded the first time a word card opens), `en.json` (English → Japanese).

## Word card
Tap a word for a quick meaning (a small popup; pick another meaning there if you like). Double-click it, or press **Open panel**, for the full card: choose another meaning, join with a neighbour, split, pick another way to cut the text ("Words that start here"), or look anything up. Changes can be undone one at a time (Ctrl+Z), and "use this fix for the rest of the conversation" applies a join or meaning to later lines until New chat.

## Testing mode
Settings and downloads are not kept between visits, to experience the first run every time. Add `?keep` to the address to keep them.

## Branches
- `main` – this version (ReazonSpeech / sherpa-onnx).
- `whisper-version` – the previous Whisper (transformers.js) version, including the optional Kotoba-Whisper model.
