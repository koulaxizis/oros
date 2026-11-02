// ============================================================
// orOS Budget — Amount keypad (budget/keypad.js)
// A calculator keypad for the amount on touch screens, and sums in
// the amount field anywhere: "12+4,5" → 16,50. calc() is pure (Node
// tests); pad() builds the keys under an input. Numbers are read by
// Budget's own parseAmount (Greek and English ways of writing them),
// the result is whole cents, rounded half away from zero.
// ============================================================
(function (root) {
  "use strict";

  var OPS = { "+": 1, "-": 1, "−": 1, "*": 1, "×": 1, "/": 1, "÷": 1 };
  // Is there a sum to work out (an operator after the first character)?
  function hasOp(s) { return /.[+\-−*×/÷]/.test(String(s || "").trim()); }

  // "12+4,5" → 1650 (cents) | null. parse(text) → cents | null.
  // × and ÷ go before + and −. A trailing operator is ignored (the
  // last key pressed before Save).
  function calc(s, parse, max) {
    var str = String(s || "").replace(/\s+/g, "");
    if (!str) return null;
    str = str.replace(/[+\-−*×/÷]+$/, "");
    var parts = [], ops = [], cur = "";
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (OPS[ch] && cur) { parts.push(cur); ops.push(ch); cur = ""; }
      else if (OPS[ch]) return null;           // two operators in a row, or a leading one
      else cur += ch;
    }
    if (!cur) return null;
    parts.push(cur);
    if (parts.length > 30) return null;
    var nums = parts.map(function (p) { return parse(p); });
    if (nums.some(function (n) { return n === null; })) return null;
    // × ÷ first, in cents: a × b = a·b/100, a ÷ b = a·100/b
    var terms = [nums[0]], signs = [1];
    for (var j = 0; j < ops.length; j++) {
      var o = ops[j], b = nums[j + 1];
      if (o === "*" || o === "×") terms[terms.length - 1] = terms[terms.length - 1] * b / 100;
      else if (o === "/" || o === "÷") terms[terms.length - 1] = terms[terms.length - 1] * 100 / b;
      else { terms.push(b); signs.push(o === "+" ? 1 : -1); }
    }
    var tot = 0;
    terms.forEach(function (v, k) { tot += signs[k] * v; });
    var r = tot < 0 ? -Math.round(-tot) : Math.round(tot);
    if (!isFinite(r) || r <= 0 || (max && r > max)) return null;
    return r;
  }

  // Keys under `input`: digits, the decimal mark, + − × ÷, ⌫ and =.
  // onChange() after every key. el(tag, cls, text) is the app's.
  function pad(input, opts) {
    var el = opts.el, comma = opts.comma;
    var box = el("div", "kp");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", opts.label);
    var rows = [["7", "8", "9", "÷"], ["4", "5", "6", "×"], ["1", "2", "3", "−"], [comma ? "," : ".", "0", "⌫", "+"]];
    function put(k) {
      var v = input.value;
      if (k === "⌫") v = v.slice(0, -1);
      else if (OPS[k] && (!v || OPS[v.slice(-1)])) v = v ? v.slice(0, -1) + k : v;   // replace an operator, never lead with one
      else v += k;
      input.value = v;
      opts.onChange();
    }
    rows.forEach(function (r) {
      r.forEach(function (k) {
        var b = el("button", "kp-key" + (OPS[k] ? " op" : k === "⌫" ? " del" : ""), k);
        b.type = "button";
        b.tabIndex = -1;                 // the field keeps the focus; keyboards type into it
        if (k === "⌫") b.setAttribute("aria-label", opts.back);
        if (k === "÷") b.setAttribute("aria-label", opts.div);
        if (k === "×") b.setAttribute("aria-label", opts.mul);
        b.addEventListener("click", function () { put(k); });
        box.appendChild(b);
      });
    });
    var eq = el("button", "kp-key eq", "=");
    eq.type = "button";
    eq.tabIndex = -1;
    eq.setAttribute("aria-label", opts.eq);
    eq.addEventListener("click", function () { opts.onEquals(); });
    box.appendChild(eq);
    return box;
  }

  var api = { calc: calc, hasOp: hasOp, pad: pad };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetKeypad = api;
})(typeof window !== "undefined" ? window : this);
