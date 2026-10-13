export const DEFAULT_SOURCE_URL = "https://test.ooobs.ru/api/orders";

// Russian national numbers have 10 digits; 8 is the domestic trunk prefix.
export function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let digits = String(value).replace(/[^0-9]/g, "");
  if (digits.length === 10) digits = "7" + digits;
  if (digits.length === 11 && digits[0] === "8") digits = "7" + digits.slice(1);
  return /^7[0-9]{10}$/.test(digits) ? "+" + digits : null;
}

export function synchronize(orders) {
  if (!Array.isArray(orders)) throw new TypeError("Source must return an array");
  const byPhone = new Map();
  let invalidDropped = 0;
  let duplicatesMerged = 0;
  for (const order of orders) {
    const phone = normalizePhone(order?.phone);
    if (!phone) {
      invalidDropped++;
      continue;
    }
    const amount = Number(order.amount);
    if (!Number.isFinite(amount)) throw new TypeError("Invalid source amount");
    const parsedDate = Date.parse(order.created_at);
    const timestamp = Number.isFinite(parsedDate) ? parsedDate : -Infinity;
    const candidate = {
      client: { name: order.name ?? "", phone, email: order.email ?? "", amount },
      timestamp,
    };
    const previous = byPhone.get(phone);
    if (previous) duplicatesMerged++;
    if (!previous || amount > previous.client.amount ||
        (amount === previous.client.amount && timestamp > previous.timestamp)) {
      byPhone.set(phone, candidate);
    }
  }
  const clients = [...byPhone.values()].map(value => value.client)
    .sort((a, b) => a.phone < b.phone ? -1 : a.phone > b.phone ? 1 : 0);
  return {
    clients,
    stats: {
      received: orders.length,
      unique: clients.length,
      duplicates_merged: duplicatesMerged,
      invalid_dropped: invalidDropped,
    },
  };
}

export async function handleRequest(request, env = {}, fetcher = fetch) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/" && pathname !== "/api/clients") {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const response = await fetcher(env.ORDERS_URL || DEFAULT_SOURCE_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Upstream HTTP error");
    const result = synchronize(await response.json());
    return new Response(request.method === "HEAD" ? null : JSON.stringify(result), { headers });
  } catch {
    // Never disguise source failures as a successful empty synchronization.
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: "upstream_unavailable" }), {
      status: 502, headers,
    });
  }
}

export default {
  fetch(request, env) { return handleRequest(request, env); },
};
