// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// Runs the encoder off the page's main thread.

import { encode } from './encoder.js?v=1df6d0c7c3a9704a';
import { decode } from './decoder.js?v=1df6d0c7c3a9704a';
import { equal } from './profile.js?v=1df6d0c7c3a9704a';

self.onmessage = (event) => {
  try {
    const app = new Uint8Array(event.data);
    const wav = encode(app,
        (fraction) => self.postMessage({ progress: fraction }));
    if (!equal(decode(wav, app.length), app)) {
      throw new Error('The update WAV did not reproduce the app image.');
    }
    self.postMessage({ wav }, [wav.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};

// Also lets the page verify module worker support before enabling the editor.
self.postMessage({ ready: true });
