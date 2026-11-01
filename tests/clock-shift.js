"use strict";
// Preload for tests/clock.test.js: moves the clock forward by
// CLOCK_SHIFT_DAYS. new Date() and Date.now() see the later time; dates built
// from a value stay exact. Code run inside a vm context keeps the real clock,
// so only plain test files are run with it.
const OFF = Number(process.env.CLOCK_SHIFT_DAYS || 0) * 864e5;
const Real = Date;
class Shifted extends Real {
  constructor(...a) { if (a.length === 0) super(Real.now() + OFF); else super(...a); }
  static now() { return Real.now() + OFF; }
}
Shifted.UTC = Real.UTC;
Shifted.parse = Real.parse;
globalThis.Date = Shifted;
