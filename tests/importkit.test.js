"use strict";
const test = require("node:test");
const assert = require("node:assert");
const K = require("../importkit.js");

test("csv: quotes, BOM, CRLF, sniffed delimiter", () => {
  const t = K.csv('﻿a;b;"c ""x"""\r\n1;"2;3";4\r\n\r\n5;6;7');
  assert.strictEqual(t.delim, ";");
  assert.deepStrictEqual(t.head, ["a", "b", 'c "x"']);
  assert.deepStrictEqual(t.rows, [["1", "2;3", "4"], ["5", "6", "7"]]);
  const r = K.records("Date,Mood,Date\n2024-01-02,good,x");
  assert.deepStrictEqual(r.head, ["Date", "Mood", "Date 2"]);
  assert.strictEqual(r.rows[0].Mood, "good");
  assert.strictEqual(K.get(r.rows[0], ["mood"]), "good");
  assert.strictEqual(K.csv('a,b\n"line\nbreak",2').rows[0][0], "line\nbreak");
});

test("col and detect ignore case and punctuation", () => {
  const head = ["Full Date", "Mood", "Activities"];
  assert.strictEqual(K.col(head, ["full_date"]), 0);
  assert.strictEqual(K.detect(head, [{ id: "x", need: ["nope"] }, { id: "daylio", need: ["full_date", "mood"] }]), "daylio");
  assert.strictEqual(K.detect(head, [{ id: "x", need: ["nope"] }]), "");
});

test("dates", () => {
  assert.strictEqual(K.ymd("2024-03-05"), "2024-03-05");
  assert.strictEqual(K.ymd("2024-03-05 22:10:00"), "2024-03-05");
  assert.strictEqual(K.ymd("05/03/2024"), "2024-03-05");
  assert.strictEqual(K.ymd("05/03/2024", "mdy"), "2024-05-03");
  assert.strictEqual(K.ymd("12/31/2024"), "2024-12-31");
  assert.strictEqual(K.ymd("March 5, 2024"), "2024-03-05");
  assert.strictEqual(K.ymd("Tuesday, March 5, 2024 at 10:00 PM"), "2024-03-05");
  assert.strictEqual(K.ymd("5 Mar 2024"), "2024-03-05");
  assert.strictEqual(K.ymd("2024-02-30"), "");
  assert.strictEqual(K.ymd("hello"), "");
  const ms = K.parseDate("2024-03-05 22:10");
  assert.strictEqual(new Date(ms).getHours(), 22);
  assert.strictEqual(K.parseDate("2024-03-05T10:00:00Z"), Date.UTC(2024, 2, 5, 10));
  assert.strictEqual(K.parseDate("Mar 5 2024 10:00 PM") , new Date(2024, 2, 5, 22, 0).getTime());
  assert.strictEqual(K.parseDate(1709600000), 1709600000000);
});

test("numbers, json, hash, clean, text", () => {
  assert.strictEqual(K.num("1.234,50"), 1234.5);
  assert.strictEqual(K.num("1,234.50"), 1234.5);
  assert.strictEqual(K.num("3,5"), 3.5);
  assert.strictEqual(K.num("€ -12.40"), -12.4);
  assert.ok(isNaN(K.num("")));
  assert.strictEqual(K.json("{bad"), null);
  assert.strictEqual(K.hash("abc"), K.hash("abc"));
  assert.notStrictEqual(K.hash("abc"), K.hash("abd"));
  assert.strictEqual(K.clean(" a\u0000b \n c ", 3), "a b");
  assert.strictEqual(K.cleanText("a\r\n\r\n\r\nb"), "a\n\nb");
  assert.strictEqual(K.text(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), "A");
  assert.strictEqual(K.text(new Uint8Array([0xff, 0xfe, 0x41, 0])), "A");
  assert.ok(K.isZip(new Uint8Array([0x50, 0x4b, 3, 4, 0])));
});
