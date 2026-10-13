import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, synchronize, handleRequest } from "../worker/index.js";

test("national, trunk and international formats normalize to the same phone", () => {
  for (const phone of ["+7 999 123-45-67", "8 (999) 123 45 67", "79991234567", "9991234567", 79991234567]) {
    assert.equal(normalizePhone(phone), "+79991234567");
  }
});
test("invalid lengths, absent phones and foreign prefixes are rejected", () => {
  for (const phone of ["123", "", "не указан", "+7 999", "799912345678", "+19991234567", null, undefined, {}, true]) {
    assert.equal(normalizePhone(phone), null);
  }
});
const order = (phone, amount, created_at, name = "client", email = "") => ({ phone, amount, created_at, name, email });
test("maximum amount wins even when a smaller order is newer", () => {
  const result = synchronize([
    order("89991234567", 5000, "2026-10-01T00:00:00Z", "winner", ""),
    order("+79991234567", 100, "2026-10-07T00:00:00Z", "loser", "filled@example.com"),
    order("123", 9000, "2026-10-01T00:00:00Z"),
  ]);
  assert.deepEqual(result, {
    clients: [{ name: "winner", phone: "+79991234567", email: "", amount: 5000 }],
    stats: { received: 3, unique: 1, duplicates_merged: 1, invalid_dropped: 1 },
  });
});
test("equal amounts are compared using the actual timestamp including timezone", () => {
  const result = synchronize([
    order("89991234567", 200, "2026-10-05T14:00:00+03:00", "older"),
    order("+79991234567", 200, "2026-10-05T12:00:00Z", "newer"),
  ]);
  assert.equal(result.clients[0].name, "newer");
});
test("zero and negative amounts retain their correct ordering", () => {
  assert.equal(synchronize([
    order("9991234567", -100, "2026-10-01"),
    order("9991234567", 0, "2026-10-01"),
  ]).clients[0].amount, 0);
});
test("synchronization is repeatable, sorts output and never mutates input", () => {
  const orders = [order("9991234567", 2, "2026-10-01"), order("9005551212", 1, "2026-10-01")];
  const original = structuredClone(orders);
  const first = synchronize(orders);
  assert.deepEqual(synchronize(orders), first);
  assert.deepEqual(synchronize([...orders].reverse()), first);
  assert.deepEqual(orders, original);
  assert.equal(first.clients[0].phone, "+79005551212");
});
test("empty source has zero statistics", () => {
  assert.deepEqual(synchronize([]), { clients: [], stats: { received: 0, unique: 0, duplicates_merged: 0, invalid_dropped: 0 } });
});
test("HTTP endpoint returns only the required schema and fetches each time", async () => {
  let calls = 0;
  const upstream = async url => {
    calls++;
    assert.equal(url, "https://test.ooobs.ru/api/orders");
    return Response.json([order("9005551212", 300, "2026-10-01", "Павел")]);
  };
  const responses = [];
  for (let i = 0; i < 2; i++) {
    const response = await handleRequest(new Request("https://example.org/api/clients"), {}, upstream);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    responses.push(await response.json());
  }
  assert.equal(calls, 2);
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(Object.keys(responses[0]), ["clients", "stats"]);
  assert.deepEqual(Object.keys(responses[0].clients[0]), ["name", "phone", "email", "amount"]);
});
test("source errors return 502 rather than an incorrect empty success", async () => {
  for (const upstream of [async () => new Response("failed", { status: 500 }), async () => Response.json({}), async () => { throw new Error("timeout"); }]) {
    assert.equal((await handleRequest(new Request("https://example.org/"), {}, upstream)).status, 502);
  }
});
test("routing, methods and HEAD", async () => {
  assert.equal((await handleRequest(new Request("https://example.org/missing"))).status, 404);
  assert.equal((await handleRequest(new Request("https://example.org/", { method: "POST" }))).status, 405);
  const head = await handleRequest(new Request("https://example.org/", { method: "HEAD" }), {}, async () => Response.json([]));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
