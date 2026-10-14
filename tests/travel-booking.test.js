// Reservations from booking e-mails (travel/booking.js): schema.org
// JSON-LD and microdata → itinerary entries.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const B = require(path.join(__dirname, "..", "travel/booking.js"));

function ld(obj) {
  return '<html><head><script type="application/ld+json">' + JSON.stringify(obj) + "</script></head><body><p>Hi</p></body></html>";
}

test("flight: JSON-LD FlightReservation → a flight entry, times as written on the ticket", () => {
  const html = ld({
    "@context": "http://schema.org", "@type": "FlightReservation", reservationNumber: "RXJ34P",
    reservationStatus: "http://schema.org/ReservationConfirmed",
    underName: { "@type": "Person", name: "Eva Green" },
    reservedTicket: { "@type": "Ticket", airplaneSeat: "12A" },
    totalPrice: "289.50", priceCurrency: "EUR",
    reservationFor: {
      "@type": "Flight", flightNumber: "650", airline: { "@type": "Airline", name: "Aegean", iataCode: "A3" },
      departureAirport: { "@type": "Airport", name: "Athens", iataCode: "ATH" },
      departureTime: "2026-10-12T08:15:00+03:00",
      arrivalAirport: { "@type": "Airport", name: "Rome Fiumicino", iataCode: "FCO" },
      arrivalTime: "2026-10-12T09:05:00+02:00", departureGate: "B12"
    }
  });
  const [e] = B.parseText(html, "en");
  assert.equal(e.kind, "flight");
  assert.equal(e.from, "ATH");
  assert.equal(e.to, "FCO");
  assert.equal(e.day, "2026-10-12");
  assert.equal(e.t1, "08:15");
  assert.equal(e.t2, "09:05");
  assert.equal(e.day2, "");                    // same day
  assert.equal(e.num, "A3 650");
  assert.equal(e.prov, "Aegean");
  assert.equal(e.ref, "RXJ34P");
  assert.equal(e.cost, 28950);
  assert.equal(e.ccur, "EUR");
  assert.equal(e.cancelled, false);
  assert.match(e.note, /Seat 12A/);
  assert.match(e.note, /Gate B12/);
  assert.match(e.note, /Passenger: Eva Green/);
  const [g] = B.parseText(html, "el");
  assert.match(g.note, /Θέση 12A/);
});

test("several legs, @graph, arrays and full schema.org type URLs", () => {
  const html = ld({ "@context": "https://schema.org", "@graph": [
    { "@type": "https://schema.org/FlightReservation", reservationNumber: "AB1",
      reservationFor: [
        { "@type": "Flight", flightNumber: "LH1755", airline: { iataCode: "LH" }, departureAirport: { iataCode: "ATH" },
          arrivalAirport: { iataCode: "MUC" }, departureTime: "2026-05-01T06:00", arrivalTime: "2026-05-01T08:00" },
        { "@type": "Flight", flightNumber: "LH400", departureAirport: { iataCode: "MUC" },
          arrivalAirport: { iataCode: "JFK" }, departureTime: "2026-05-01T22:30", arrivalTime: "2026-05-02T01:30" }
      ] },
    { "@type": "Organization", name: "noise" }
  ] });
  const list = B.parseText(html, "en");
  assert.equal(list.length, 2);
  assert.equal(list[0].num, "LH1755");          // the code is already in the number
  assert.equal(list[1].from, "MUC");
  assert.equal(list[1].day2, "2026-05-02");    // lands the next day
  assert.equal(list[1].t2, "01:30");
});

test("hotel, train, bus, ferry, car hire, event, restaurant, taxi", () => {
  const html = ld([
    { "@type": "LodgingReservation", reservationNumber: "H-77", checkinTime: "2026-10-12T15:00", checkoutTime: "2026-10-15T11:00",
      reservationFor: { "@type": "LodgingBusiness", name: "Hotel Roma", telephone: "+39 06 123",
        address: { "@type": "PostalAddress", streetAddress: "Via Nazionale 1", addressLocality: "Rome", postalCode: "00184", addressCountry: "IT" } },
      totalPrice: { "@type": "PriceSpecification", price: "1.234,50", priceCurrency: "EUR" } },
    { "@type": "TrainReservation", reservationNumber: "T1", reservedTicket: { ticketedSeat: { seatNumber: "45", seatSection: "7" } },
      reservationFor: { "@type": "TrainTrip", trainNumber: "FR 9512", provider: { name: "Trenitalia" },
        departureStation: { name: "Roma Termini" }, arrivalStation: { name: "Firenze S.M.N." },
        departureTime: "2026-10-13T09:10", arrivalTime: "2026-10-13T10:45", departurePlatform: "8" } },
    { "@type": "BusReservation", reservationFor: { "@type": "BusTrip", busNumber: "N12", departureBusStop: { name: "A" },
      arrivalBusStop: { name: "B" }, departureTime: "2026-10-14T07:00" } },
    { "@type": "BoatReservation", reservationNumber: "F9", reservationFor: { "@type": "BoatTrip",
      departureBoatTerminal: { name: "Piraeus" }, arrivalBoatTerminal: { name: "Naxos" }, departureTime: "2026-07-01T07:25" } },
    { "@type": "RentalCarReservation", reservationNumber: "RC5", pickupTime: "2026-10-12T10:00", dropoffTime: "2026-10-15T09:00",
      pickupLocation: { "@type": "Place", name: "FCO Terminal 3" }, dropoffLocation: { "@type": "Place", name: "Roma Termini" },
      reservationFor: { "@type": "Car", name: "Fiat 500", brand: { name: "Fiat" }, rentalCompany: { name: "Hertz" } } },
    { "@type": "EventReservation", reservationNumber: "E1", reservedTicket: { ticketNumber: "TK-9" },
      reservationFor: { "@type": "Event", name: "Aida", startDate: "2026-10-14T20:30", endDate: "2026-10-14T23:00",
        location: { "@type": "Place", name: "Teatro dell'Opera", address: "Piazza Beniamino Gigli 7, Rome" } } },
    { "@type": "FoodEstablishmentReservation", startTime: "2026-10-13T20:00", partySize: 4,
      reservationFor: { "@type": "FoodEstablishment", name: "Da Enzo" } },
    { "@type": "TaxiReservation", pickupTime: "2026-10-12T06:00", pickupLocation: { name: "Home" } }
  ]);
  const by = {};
  B.parseText(html, "en").forEach((e) => { by[e.kind] = by[e.kind] || e; });
  assert.equal(by.stay.title, "Hotel Roma");
  assert.equal(by.stay.place, "Hotel Roma, Via Nazionale 1, 00184 Rome, IT");
  assert.deepEqual([by.stay.day, by.stay.t1, by.stay.day2, by.stay.t2], ["2026-10-12", "15:00", "2026-10-15", "11:00"]);
  assert.equal(by.stay.cost, 123450);
  assert.equal(by.stay.ccur, "EUR");
  assert.equal(by.train.num, "FR 9512");
  assert.equal(by.train.prov, "Trenitalia");
  assert.match(by.train.note, /Coach 7 · Seat 45 · Platform 8/);
  assert.equal(by.bus.num, "N12");
  assert.equal(by.ferry.from, "Piraeus");
  assert.equal(by.rental.title, "Hertz · Fiat Fiat 500");
  assert.equal(by.rental.place, "FCO Terminal 3");
  assert.equal(by.rental.day2, "2026-10-15");
  assert.match(by.rental.note, /Return at: Roma Termini/);
  assert.equal(by.ticket.title, "Aida");
  assert.equal(by.ticket.t2, "23:00");
  assert.match(by.ticket.place, /^Teatro dell'Opera, Piazza/);
  assert.match(by.ticket.note, /Ticket TK-9/);
  assert.equal(by.food.title, "Da Enzo");
  assert.match(by.food.note, /Party of 4/);
  assert.equal(by.car.title, "Taxi");
  assert.equal(by.car.from, "Home");
});

test("microdata (itemscope / itemprop) on small fake DOM nodes", () => {
  function n(tagName, attrs, children, text) {
    attrs = attrs || {};
    return { tagName, children: children || [], textContent: text || "",
      getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs };
  }
  const root = n("div", {}, [
    n("div", { itemscope: "", itemtype: "http://schema.org/FlightReservation" }, [
      n("meta", { itemprop: "reservationNumber", content: "MD1" }),
      n("div", { itemprop: "reservationFor", itemscope: "", itemtype: "http://schema.org/Flight" }, [
        n("meta", { itemprop: "flightNumber", content: "123" }),
        n("div", { itemprop: "airline", itemscope: "", itemtype: "http://schema.org/Airline" }, [
          n("meta", { itemprop: "iataCode", content: "OA" }), n("span", { itemprop: "name" }, [], "Olympic")
        ]),
        n("div", { itemprop: "departureAirport", itemscope: "", itemtype: "http://schema.org/Airport" }, [
          n("meta", { itemprop: "iataCode", content: "SKG" })
        ]),
        n("div", { itemprop: "arrivalAirport", itemscope: "", itemtype: "http://schema.org/Airport" }, [
          n("meta", { itemprop: "iataCode", content: "ATH" })
        ]),
        n("p", {}, [n("time", { itemprop: "departureTime", datetime: "2026-03-02T17:40:00+02:00" }, [], "17:40")])
      ])
    ])
  ]);
  const items = B.microdata(root);
  assert.equal(items.length, 1);
  const [e] = B.reservations(B.nodes(items), "en");
  assert.deepEqual([e.kind, e.ref, e.num, e.prov, e.from, e.to, e.day, e.t1],
    ["flight", "MD1", "OA 123", "Olympic", "SKG", "ATH", "2026-03-02", "17:40"]);
});

test("safety and junk: scripts are never run, bad JSON and other types give nothing", () => {
  global.__pwned = false;
  const html = '<script>global.__pwned = true</script><script type="application/ld+json">{ not json </script>' +
    '<script type="application/ld+json">{"@type":"Person","name":"x"}</script><img src=x onerror="global.__pwned=true">';
  assert.deepEqual(B.parseText(html, "en"), []);
  assert.equal(global.__pwned, false);
  assert.deepEqual(B.parseText("", "en"), []);
  assert.deepEqual(B.parseText("plain text with no data", "en"), []);
  // a reservation with nothing usable is skipped; control characters are cleaned
  const list = B.parseText(ld([{ "@type": "LodgingReservation" },
    { "@type": "LodgingReservation", reservationFor: { name: "Ho\u0007tel\n<b>X</b>" }, checkinDate: "2026-02-30" }]), "en");
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Ho tel <b>X</b>");   // text only; the app puts it on the page with textContent
  assert.equal(list[0].day, "");                     // not a real date
});

test("the same booking twice (JSON-LD + microdata copy) is kept once; cancelled ones are flagged", () => {
  const r = { "@type": "TrainReservation", reservationNumber: "Z9", reservationStatus: "https://schema.org/ReservationCancelled",
    reservationFor: { "@type": "TrainTrip", trainNumber: "IC 5", departureStation: { name: "X" }, arrivalStation: { name: "Y" },
      departureTime: "2026-01-01T10:00" } };
  const list = B.reservations(B.nodes([r, JSON.parse(JSON.stringify(r))]), "en");
  assert.equal(list.length, 1);
  assert.equal(list[0].cancelled, true);
});

test("amounts and dates", () => {
  assert.equal(B.cents("1,234.50"), 123450);
  assert.equal(B.cents("1.234,50"), 123450);
  assert.equal(B.cents("12,5"), 1250);
  assert.equal(B.cents("1,234"), 123400);
  assert.equal(B.cents(99), 9900);
  assert.equal(B.cents("€ 45"), 4500);
  assert.equal(B.cents("abc"), 0);
  assert.deepEqual(B.dt("2026-10-12T08:15:00Z"), { day: "2026-10-12", time: "08:15" });
  assert.deepEqual(B.dt("2026-10-12"), { day: "2026-10-12", time: "" });
  assert.deepEqual(B.dt("12/10/2026"), { day: "", time: "" });
  assert.equal(B.typeName({ "@type": ["Thing", "http://schema.org/LodgingReservation"] }), "Thing");
});
