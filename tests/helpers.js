/**
 * Shared test helpers — spins up the Express app on a random port,
 * returns a simple fetch wrapper, and tears down cleanly after each suite.
 */

const app = require("../src/app");

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function makeClient(server) {
  const { port } = server.address();
  const base = `http://localhost:${port}`;

  async function request(method, path, { body, headers = {}, cookie } = {}) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json", ...headers }
    };
    if (cookie) opts.headers.Cookie = cookie;
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(`${base}${path}`, opts);
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, body: json };
  }

  return {
    get:    (path, opts)       => request("GET",    path, opts),
    post:   (path, body, opts) => request("POST",   path, { body, ...opts }),
    patch:  (path, body, opts) => request("PATCH",  path, { body, ...opts }),
    delete: (path, opts)       => request("DELETE", path, opts)
  };
}

module.exports = { startServer, makeClient };
