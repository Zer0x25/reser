import { createServer } from "node:http";

const messages = [];
const expectedToken = process.env.MAIL_DELIVERY_TOKEN ?? "e2e-mail-token";

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:3002");
  if (req.method === "GET" && url.pathname === "/messages") {
    const recipient = url.searchParams.get("to");
    return json(
      res,
      200,
      messages.filter((message) => !recipient || message.to === recipient),
    );
  }
  if (req.method !== "POST" || url.pathname !== "/deliver")
    return json(res, 404, { error: "Not found" });
  if (req.headers.authorization !== `Bearer ${expectedToken}`)
    return json(res, 401, { error: "Unauthorized" });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!message.to || !message.subject || !message.text)
      return json(res, 400, { error: "Invalid message" });
    messages.push(message);
    return json(res, 202, { accepted: true });
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }
});

server.listen(3002, "127.0.0.1", () => {
  process.stdout.write("E2E mail sink listening on http://127.0.0.1:3002\n");
});
