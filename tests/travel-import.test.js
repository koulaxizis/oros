// Travel — trips from other apps (travel/import.js): Polarsteps data
// export (trip.json + locations.json in a ZIP, or a bare trip.json)
// and TripIt calendar feeds (.ics): detection, mapping to trips,
// itinerary entries and journal days, stable ids, and the plan that
// adds only what is missing.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const I = require(path.join(__dirname, "..", "travel/import.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const zip = (files) => Z.write(Object.keys(files).map((name) => ({ name, data: typeof files[name] === "string" ? enc(files[name]) : files[name] })));
const unix = (iso) => Date.parse(iso) / 1000;

const POLAR = {
  id: 9876543, name: "Greek islands", summary: "Two weeks of ferries", timezone_id: "Europe/Athens",
  start_date: unix("2026-06-01T06:00:00Z"), end_date: unix("2026-06-14T18:00:00Z"),
  all_steps: [
    { id: 2, display_name: "Naxos town", description: "Swim at Agios Prokopios.", start_time: unix("2026-06-03T21:30:00Z"),
      timezone_id: "Europe/Athens", location: { name: "Chora", detail: "Greece", lat: 37.1036, lon: 25.3766, country_code: "GR" } },
    { id: 1, name: "Athens", description: "Acropolis at sunrise.\nThen <b>souvlaki</b>.", start_time: unix("2026-06-01T05:00:00Z"),
      location: { name: "Athens", detail: "Greece", lat: 37.98, lon: 23.72, country_code: "GR" } },
    { id: 3, name: "Lunch", description: "", start_time: unix("2026-06-03T09:00:00Z"),
      location: { name: "Naxos", detail: "Greece", lat: "x", lon: 1 } }
  ]
};

test("Polarsteps ZIP: a trip, a stop per step (local time, map point), journal days; photos and track counted", async () => {
  const res = await I.read("user_data.zip", zip({
    "user/user.json": "{}",
    "trip/Greek islands_9876543/trip.json": JSON.stringify(POLAR),
    "trip/Greek islands_9876543/locations.json": JSON.stringify({ locations: [{ lat: 1, lon: 2, time: 1 }, { lat: 1, lon: 2.1, time: 2 }] }),
    "trip/Greek islands_9876543/naxos_2/photos/a.jpg": new Uint8Array([1, 2, 3])
  }));
  assert.equal(res.source, "polarsteps");
  assert.equal(res.trips.length, 1);
  assert.deepEqual(res.skip, { photos: 1, points: 2, outside: 0, cancelled: 0 });
  const t = res.trips[0];
  assert.equal(t.id, I.idOf("polarsteps", "9876543"));
  assert.match(t.id, /^imp-[a-z0-9]+$/);
  assert.equal(t.name, "Greek islands");
  assert.equal(t.dest, "Greece");
  assert.equal(t.start, "2026-06-01");
  assert.equal(t.end, "2026-06-14");
  assert.equal(t.notes, "Two weeks of ferries");
  assert.deepEqual(t.entries.map((e) => [e.title, e.day, e.t1]), [
    ["Athens", "2026-06-01", "08:00"],          // sorted by time, Athens time (UTC+3)
    ["Lunch", "2026-06-03", "12:00"],
    ["Naxos town", "2026-06-04", "00:30"]       // past midnight there
  ]);
  assert.deepEqual(t.entries[0].geo, { lat: 37.98, lon: 23.72 });
  assert.equal(t.entries[1].geo, null);
  assert.equal(t.entries[0].kind, "activity");
  assert.equal(t.entries[0].place, "Athens, Greece");
  assert.deepEqual(t.jrnl.map((j) => j.day), ["2026-06-01", "2026-06-04"]);
  assert.equal(t.jrnl[0].text, "Athens\nAcropolis at sunrise.\nThen <b>souvlaki</b>.");   // text only, never HTML
  // a bare trip.json gives the same trip
  const bare = await I.read("trip.json", JSON.stringify(POLAR));
  assert.equal(bare.trips[0].id, t.id);
  assert.deepEqual(bare.trips[0].entries.map((e) => e.id), t.entries.map((e) => e.id));
});

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TripIt//EN",
  "BEGIN:VEVENT", "UID:trip-111@tripit.com", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261016",
  "SUMMARY:Munich\\, Germany\\, October 2026", "LOCATION:Munich\\, Germany",
  "DESCRIPTION:View and/or edit details in TripIt : https://www.tripit.com/trip/show/id/111", "END:VEVENT",
  "BEGIN:VEVENT", "UID:air-1@tripit.com", "DTSTART;TZID=Europe/Athens:20261012T081500", "DTEND;TZID=Europe/Berlin:20261012T094500",
  "SUMMARY:LH1755 ATH to MUC", "LOCATION:Athens (ATH)",
  "DESCRIPTION:[Flight] 10/12/2026 Lufthansa(LH) #1755 dep ATH 8:15am EEST\\; arr MUC 9:45am CEST\\; Confirmation #K7XQ2P", "END:VEVENT",
  "BEGIN:VEVENT", "UID:hotel-in@tripit.com", "DTSTART:20261012T150000", "DTEND:20261012T160000",
  "SUMMARY:Check-in: Hotel Adler", "LOCATION:Maxstr. 1\\, Munich", "DESCRIPTION:[Lodging] Hotel Adler\\nConfirmation: 55512345", "END:VEVENT",
  "BEGIN:VEVENT", "UID:hotel-out@tripit.com", "DTSTART:20261015T110000", "DTEND:20261015T120000",
  "SUMMARY:Check-out: Hotel Adler", "DESCRIPTION:[Lodging] Hotel Adler", "END:VEVENT",
  "BEGIN:VEVENT", "UID:rail-1@tripit.com", "DTSTART:20261014T090000", "DTEND:20261014T103000",
  "SUMMARY:Rail: Munich to Salzburg", "DESCRIPTION:[Rail] ICE 512", "END:VEVENT",
  "BEGIN:VEVENT", "UID:food-1@tripit.com", "DTSTART:20261013T200000", "SUMMARY:Augustiner", "DESCRIPTION:[Restaurant] table for 2", "END:VEVENT",
  "BEGIN:VEVENT", "UID:note-1@tripit.com", "DTSTART:20261013T120000", "SUMMARY:Pick up Munich card", "DESCRIPTION:[Note] at the station", "END:VEVENT",
  "BEGIN:VEVENT", "UID:gone@tripit.com", "STATUS:CANCELLED", "DTSTART:20261013T100000", "SUMMARY:Tour", "END:VEVENT",
  "BEGIN:VEVENT", "UID:far@tripit.com", "DTSTART:20261201T100000", "SUMMARY:Dentist", "END:VEVENT",
  "BEGIN:VEVENT", "UID:air-2@tripit.com", "DTSTART:20261015T170000Z", "DTEND:20261015T203000Z",
  "SUMMARY:A3 821 MUC to ATH", "DESCRIPTION:[Flight]", "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n");

test("TripIt .ics: the trip event holds flights, hotel stays, rail, food; the rest as notes", async () => {
  const res = await I.read("tripit.ics", enc(ICS));
  assert.equal(res.source, "tripit");
  assert.equal(res.trips.length, 1);
  assert.equal(res.skip.cancelled, 1);
  assert.equal(res.skip.outside, 1);              // the dentist in December
  const t = res.trips[0];
  assert.equal(t.id, I.idOf("tripit", "trip-111@tripit.com"));
  assert.equal(t.name, "Munich, Germany, October 2026");
  assert.equal(t.dest, "Munich, Germany");
  assert.equal(t.start, "2026-10-12");
  assert.equal(t.end, "2026-10-15");              // DTEND of an all-day event is exclusive
  const by = Object.fromEntries(t.entries.map((e) => [e.id, e]));
  const fl = by[I.idOf("tripit", "air-1@tripit.com")];
  assert.equal(fl.kind, "flight");
  assert.equal(fl.num, "LH1755");
  assert.equal(fl.from, "ATH");
  assert.equal(fl.to, "MUC");
  assert.equal(fl.day, "2026-10-12");
  assert.equal(fl.t1, "08:15");                   // as written in its zone
  assert.equal(fl.t2, "09:45");
  assert.equal(fl.ref, "K7XQ2P");
  const st = by[I.idOf("tripit", "hotel-in@tripit.com")];
  assert.equal(st.kind, "stay");
  assert.equal(st.title, "Hotel Adler");
  assert.equal(st.day, "2026-10-12");
  assert.equal(st.day2, "2026-10-15");            // the check-out event closes the stay
  assert.equal(st.ref, "55512345");
  assert.equal(by[I.idOf("tripit", "hotel-out@tripit.com")], undefined);
  const rail = by[I.idOf("tripit", "rail-1@tripit.com")];
  assert.equal(rail.kind, "train");
  assert.equal(rail.from, "Munich");
  assert.equal(rail.to, "Salzburg");
  assert.equal(by[I.idOf("tripit", "food-1@tripit.com")].kind, "food");
  const note = by[I.idOf("tripit", "note-1@tripit.com")];
  assert.equal(note.kind, "other");
  assert.equal(note.title, "Pick up Munich card");
  assert.equal(note.note, "[Note] at the station");
  const back = by[I.idOf("tripit", "air-2@tripit.com")];
  assert.equal(back.kind, "flight");
  assert.equal(back.num, "A3821");
  assert.equal(back.day, "2026-10-15");           // UTC → this device's day (stays the same here)
  assert.equal(t.entries.length, 6);
});

test("TripIt: several trips in a feed; a file with no trip event becomes one trip", async () => {
  const two = ICS.replace("END:VCALENDAR", [
    "BEGIN:VEVENT", "UID:trip-222@tripit.com", "DTSTART;VALUE=DATE:20261130", "DTEND;VALUE=DATE:20261203", "SUMMARY:Lisbon", "END:VEVENT",
    "END:VCALENDAR"].join("\r\n"));
  const r2 = await I.read("feed.ics", two);
  assert.equal(r2.trips.length, 2);
  assert.equal(r2.skip.outside, 0);
  assert.deepEqual(r2.trips[1].entries.map((e) => e.title), ["Dentist"]);
  const segOnly = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x1", "DTSTART:20270101T100000", "SUMMARY:OA 123 ATH to JTR", "END:VEVENT",
    "BEGIN:VEVENT", "UID:x2", "DTSTART:20270105T100000", "SUMMARY:OA 124 JTR to ATH", "END:VEVENT", "END:VCALENDAR"].join("\n");
  const r1 = await I.read("santorini_trip.ics", segOnly);
  assert.equal(r1.trips.length, 1);
  assert.equal(r1.trips[0].name, "santorini trip");
  assert.equal(r1.trips[0].start, "2027-01-01");
  assert.equal(r1.trips[0].end, "2027-01-05");
  assert.equal(r1.trips[0].dest, "JTR");
});

test("plan: only what is missing; nothing of the person's trip changes", async () => {
  const res = await I.read("tripit.ics", ICS);
  const t = res.trips[0];
  const fresh = I.plan({ trips: [] }, res)[0];
  assert.equal(fresh.cur, null);
  assert.equal(fresh.add.length, 6);
  // the trip is here with two of the entries (one edited by the person) and a journal day
  const cur = { id: t.id, name: "My Munich", plan: [Object.assign({}, t.entries[0], { title: "edited" }), t.entries[1]],
                jrnl: [{ id: "j1", day: "2026-10-12", text: "mine" }] };
  const again = I.plan({ trips: [cur] }, res)[0];
  assert.equal(again.cur, cur);
  assert.equal(again.have, 2);
  assert.deepEqual(again.add.map((e) => e.id), t.entries.slice(2).map((e) => e.id));
  const p = await I.read("trip.json", JSON.stringify(POLAR));
  const pj = I.plan({ trips: [{ id: p.trips[0].id, plan: [], jrnl: [{ day: "2026-06-01", text: "x" }] }] }, p)[0];
  assert.deepEqual(pj.jrnl.map((j) => j.day), ["2026-06-04"]);
});

test("not ours, hostile and oversized input", async () => {
  assert.equal(await I.read("x.json", '{"app":"oros-travel","data":{"trips":[]}}'), null);
  assert.equal(await I.read("x.zip", zip({ "a.txt": "x" })), null);
  assert.equal(await I.read("x.ics", "BEGIN:VCALENDAR\nEND:VCALENDAR"), null);
  const evil = await I.read("e.ics", ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:<img src=x onerror=alert(1)>",
    "DTSTART:20270101T100000", "SUMMARY:<script>alert(1)</script>" + "x".repeat(500), "END:VEVENT", "END:VCALENDAR"].join("\n"));
  const e = evil.trips[0].entries[0];
  assert.ok(e.title.length <= 100);
  assert.match(e.id, /^imp-[a-z0-9]+$/);
  await assert.rejects(I.read("big.zip", { length: I.MAX_FILE + 1 }), /toobig/);
  const many = { name: "Long", all_steps: Array.from({ length: 400 }, (_, i) => ({ id: i, name: "S" + i, start_time: 1700000000 + i * 3600 })) };
  const r = await I.read("trip.json", JSON.stringify(many));
  assert.equal(r.trips[0].entries.length, 300);
});
