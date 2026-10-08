import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createFixtureAdapter } from "./src/fixtures.js";
import serviceModule from "./src/service.js";

export function createServer({ adapter = createFixtureAdapter() } = {}) {
  const service = serviceModule.createService(adapter, { id: randomUUID });
  const assets = {
    "/": ["web/index.html", "text/html"],
    "/app.js": ["web/app.js", "text/javascript"],
    "/style.css": ["web/style.css", "text/css"],
  };
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const reply = (code, payload) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
        return reply(403, { error: "Invalid host." });
      if (req.method === "GET" && assets[req.url]) {
        const [path, type] = assets[req.url];
        res.writeHead(200, { "Content-Type": type });
        res.end(await readFile(new URL(path, import.meta.url)));
        return;
      }
      if (req.method !== "POST" || req.url !== "/api")
        return reply(404, { error: "Not found." });
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        return reply(403, { error: "Cross-origin request refused." });
      if (!(req.headers["content-type"] || "").startsWith("application/json"))
        return reply(415, { error: "JSON required." });
      let data = "",
        size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return reply(413, { error: "Request too large." });
        data += chunk;
      }
      const body = JSON.parse(data);

      const result = service.route(body);
      reply(200, { data: result });
    } catch (e) {
      reply(400, {
        error: e.code
          ? e.message
          : "Request failed. Check the input and server configuration.",
        code: e.code || "REQUEST_FAILED",
      });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, "127.0.0.1", () =>
    console.log(
      `NetSuite Record Explorer: http://127.0.0.1:${port} (synthetic fixtures)`,
    ),
  );
}
