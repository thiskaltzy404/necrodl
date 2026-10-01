// GET /api/download?url=<direct media url>&name=<file name>
// Streams the file through the server so the browser can save it and show real progress.
const dns = require("dns").promises;
const net = require("net");
const { Readable } = require("stream");

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("Unsupported protocol");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!ips.length || ips.some((i) => isPrivate(i.address))) throw new Error("Blocked address");
}

module.exports = async (req, res) => {
  try {
    let u = new URL(String(req.query.url || ""));
    let upstream;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(u);
      upstream = await fetch(u, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" },
      });
      const loc = upstream.headers.get("location");
      if (upstream.status >= 300 && upstream.status < 400 && loc) u = new URL(loc, u);
      else break;
    }
    if (!upstream.ok || !upstream.body) throw new Error("Upstream " + upstream.status);
    const type = upstream.headers.get("content-type") || "application/octet-stream";
    if (/text\/html/i.test(type)) throw new Error("Not a media file");

    const name = String(req.query.name || "download").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120) || "download";
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("Cache-Control", "no-store");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ ok: false, message: e.message });
    else res.end();
  }
};
