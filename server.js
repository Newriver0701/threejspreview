const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const DIST_ROOT = path.resolve(__dirname, "dist");
const VENDOR_ROOT = path.resolve(__dirname, "node_modules");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm"
};

function setIsolationHeaders(response) {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function safeResolve(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function parsePathname(requestUrl) {
  try {
    return decodeURIComponent(new URL(requestUrl, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
}

function getRequestedFile(pathname) {
  if (pathname.startsWith("/vendor/")) {
    return safeResolve(VENDOR_ROOT, pathname.slice("/vendor/".length));
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  return safeResolve(DIST_ROOT, relativePath);
}

function serveFile(request, response, requestedFile) {
  fs.stat(requestedFile, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(requestedFile).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": "no-cache"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = fs.createReadStream(requestedFile);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
}

const server = http.createServer((request, response) => {
  setIsolationHeaders(response);

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const pathname = parsePathname(request.url);
  if (!pathname) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  if (pathname === "/health") {
    const body = JSON.stringify({ status: "ok" });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store"
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return;
  }

  const requestedFile = getRequestedFile(pathname);
  if (!requestedFile) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  serveFile(request, response, requestedFile);
});

server.listen(PORT, HOST, () => {
  console.log(`Three.js Preview listening on ${HOST}:${PORT}`);
});

function closeServer() {
  if (!server.listening) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
