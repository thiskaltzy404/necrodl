// GET /api/mp3?url=<direct video url>&name=<file name>  ->  audio/mpeg
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const ffmpeg = require("ffmpeg-static");

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
  const id = Date.now() + "-" + Math.random().toString(36).slice(2);
  const input = path.join(os.tmpdir(), id + ".in");
  const output = path.join(os.tmpdir(), id + ".mp3");
  const clean = () => { fs.rm(input, { force: true }, () => {}); fs.rm(output, { force: true }, () => {}); };
  try {
    let u = new URL(String(req.query.url || ""));
    let up;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(u);
      up = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" } });
      const loc = up.headers.get("location");
      if (up.status >= 300 && up.status < 400 && loc) u = new URL(loc, u); else break;
    }
    if (!up.ok || !up.body) throw new Error("Upstream " + up.status);
    await pipeline(Readable.fromWeb(up.body), fs.createWriteStream(input));
    await new Promise((ok, no) => {
      const f = spawn(ffmpeg, ["-y", "-i", input, "-vn", "-map", "0:a:0", "-codec:a", "libmp3lame", "-b:a", "128k", output]);
      f.on("error", no);
      f.on("close", (c) => (c === 0 ? ok() : no(new Error("ffmpeg exit " + c))));
    });
    const name = String(req.query.name || "audio.mp3").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", fs.statSync(output).size);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(output).on("close", clean).pipe(res);
  } catch (e) {
    clean();
    if (!res.headersSent) res.status(500).json({ ok: false, message: e.message });
    else res.end();
  }
};
