// ============================================================
// orOS Studio — live loudness meter (AudioWorklet, v1.0.0)
// Runs StudioMeter.Meter (meter.js, added to the worklet scope first)
// on what the master sends to the speakers and posts the numbers every
// 100 ms: { m, s, i, lra, mmax, smax, tp, sp, run }. Messages in:
// "reset" (integrated, range and maxima start again), "run" / "pause"
// (count only while the song plays, so stopping does not pull the
// integrated value down). Outputs silence.
// ============================================================
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class StudioLoudness extends AudioWorkletProcessor {
  constructor() {
    super();
    this.meter = new globalThis.StudioMeter.Meter(sampleRate, 2);
    this.run = false;
    this.left = 0;
    this.every = Math.round(sampleRate / 10);
    this.port.onmessage = (e) => {
      if (e.data === "reset") this.meter.reset();
      else if (e.data === "run") this.run = true;
      else if (e.data === "pause") this.run = false;
    };
  }
  process(inputs) {
    const inp = inputs[0];
    if (!this.run || !inp || !inp.length) return true;
    const len = inp[0].length;
    this.meter.push([inp[0], inp[1] || inp[0]], len, 0);
    this.left -= len;
    if (this.left <= 0) {
      this.left += this.every;
      const r = this.meter.read();
      r.run = this.run;
      this.port.postMessage(r);
    }
    return true;
  }
}
registerProcessor("studio-loudness", StudioLoudness);
