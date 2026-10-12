// ============================================================
// orOS Studio — recorder (AudioWorklet, v1.0.0)
// Copies the input (one or two channels) to the app in blocks of
// about 4096 frames. The first message carries the audio-clock time
// of the first frame, so the app can place the take on the timeline.
// Records nothing to the output (it outputs silence).
// ============================================================
/* global AudioWorkletProcessor, registerProcessor, currentTime */
class StudioRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.first = true;
    this.buf = null;
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data === "stop") { this.flush(); this.on = false; this.port.postMessage({ done: true }); } };
  }
  flush() {
    if (!this.buf || !this.n) return;
    const out = this.buf.map((c) => c.slice(0, this.n));
    this.port.postMessage({ chunk: out }, out.map((c) => c.buffer));
    this.buf = null; this.n = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const ch = Math.min(2, inp.length), len = inp[0].length;
    if (this.first) { this.first = false; this.port.postMessage({ start: currentTime, ch: ch }); }
    if (!this.buf) { this.buf = []; for (let c = 0; c < ch; c++) this.buf.push(new Float32Array(4096)); this.n = 0; }
    for (let c = 0; c < this.buf.length; c++) this.buf[c].set(inp[Math.min(c, ch - 1)], this.n);
    this.n += len;
    if (this.n + len > 4096) this.flush();
    return true;
  }
}
registerProcessor("studio-recorder", StudioRecorder);
