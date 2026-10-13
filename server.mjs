import { createServer } from "node:http";
import { handleRequest } from "./worker/index.js";

const server = createServer(async (incoming, outgoing) => {
  const request = new Request(new URL(incoming.url, "http://localhost"), { method: incoming.method });
  const response = await handleRequest(request, { ORDERS_URL: process.env.ORDERS_URL });
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
  console.log("Orders synchronizer is listening");
});
