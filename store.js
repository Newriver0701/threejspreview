const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function initializeStore() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY, name varchar(120) NOT NULL, code text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS assets (
    id uuid PRIMARY KEY, mime varchar(32) NOT NULL, bytes bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("ファイルまたはデータが大きすぎます。"), { status: 413 }));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function handleApi(request, response, pathname) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" });
    response.end();
    return;
  }
  if (!pool) return sendJson(response, 503, { error: "DATABASE_URLが未設定です。RailwayのPostgreSQLを接続してください。" });
  try {
    if (pathname === "/api/projects" && request.method === "GET") {
      const result = await pool.query("SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC LIMIT 200");
      return sendJson(response, 200, result.rows);
    }
    if (pathname === "/api/projects" && request.method === "POST") {
      const input = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8"));
      const name = String(input.name || "無題").trim().slice(0, 120);
      const code = String(input.code || "");
      const id = randomUUID();
      await pool.query("INSERT INTO projects (id, name, code) VALUES ($1,$2,$3)", [id, name, code]);
      return sendJson(response, 201, { id, name, code });
    }
    const project = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    if (project && isUuid(project[1])) {
      const id = project[1];
      if (request.method === "GET") {
        const result = await pool.query("SELECT id, name, code, updated_at FROM projects WHERE id=$1", [id]);
        return sendJson(response, result.rowCount ? 200 : 404, result.rows[0] || { error: "作品が見つかりません。" });
      }
      if (request.method === "PUT") {
        const input = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8"));
        const name = String(input.name || "無題").trim().slice(0, 120);
        const code = String(input.code || "");
        const result = await pool.query("UPDATE projects SET name=$2, code=$3, updated_at=now() WHERE id=$1 RETURNING id, name, updated_at", [id, name, code]);
        return sendJson(response, result.rowCount ? 200 : 404, result.rows[0] || { error: "作品が見つかりません。" });
      }
      if (request.method === "DELETE") {
        await pool.query("DELETE FROM projects WHERE id=$1", [id]);
        return sendJson(response, 200, { ok: true });
      }
    }
    if (pathname === "/api/assets" && request.method === "POST") {
      const mime = String(request.headers["content-type"] || "").split(";")[0];
      if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return sendJson(response, 415, { error: "PNG・JPEG・WebPのみ対応します。" });
      const bytes = await readBody(request, 5 * 1024 * 1024);
      const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      if (!valid) return sendJson(response, 415, { error: "画像ファイルの形式が正しくありません。" });
      const id = randomUUID();
      await pool.query("INSERT INTO assets (id, mime, bytes) VALUES ($1,$2,$3)", [id, mime, bytes]);
      return sendJson(response, 201, { id, url: `/api/assets/${id}` });
    }
    const asset = /^\/api\/assets\/([^/]+)$/.exec(pathname);
    if (asset && isUuid(asset[1]) && (request.method === "GET" || request.method === "HEAD")) {
      const result = await pool.query("SELECT mime, bytes FROM assets WHERE id=$1", [asset[1]]);
      if (!result.rowCount) return sendJson(response, 404, { error: "画像が見つかりません。" });
      response.writeHead(200, { "Content-Type": result.rows[0].mime, "Content-Length": result.rows[0].bytes.length,
        "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" });
      response.end(request.method === "HEAD" ? undefined : result.rows[0].bytes);
      return;
    }
    sendJson(response, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.status ? error.message : "保存処理に失敗しました。" });
    if (!error.status) console.error(error);
  }
}

module.exports = { initializeStore, handleApi, pool };
