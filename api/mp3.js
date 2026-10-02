const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const ffmpeg = require("ffmpeg-static");

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 45_000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const value = ip.toLowerCase();

  if (value.startsWith("::ffff:")) {
    return isPrivateIp(value.slice(7));
  }

  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80")
  );
}

async function assertPublicUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported URL protocol");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Blocked private address");
    }

    return;
  }

  const addresses = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  if (!addresses.length) {
    throw new Error("Unable to resolve media host");
  }

  if (addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error("Blocked private address");
  }
}

async function fetchWithRedirects(startUrl) {
  let current = new URL(startUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicUrl(current);

    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    let response;

    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
          Accept: "*/*",
        },
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Media request timed out");
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error(
          `Redirect ${response.status} without location`
        );
      }

      current = new URL(location, current);
      continue;
    }

    return {
      response,
      finalUrl: current,
    };
  }

  throw new Error("Too many redirects");
}

function safeFilename(value) {
  const cleaned = String(value || "audio")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!cleaned) {
    return "audio.mp3";
  }

  return cleaned.toLowerCase().endsWith(".mp3")
    ? cleaned
    : `${cleaned}.mp3`;
}

async function removeFile(file) {
  try {
    await fsp.rm(file, {
      force: true,
    });
  } catch {}
}

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) {
      reject(new Error("FFmpeg binary is unavailable"));
      return;
    }

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",

      "-i",
      input,

      "-vn",

      "-map",
      "0:a:0",

      "-codec:a",
      "libmp3lame",

      "-b:a",
      "128k",

      "-ar",
      "44100",

      "-ac",
      "2",

      "-y",
      output,
    ];

    const child = spawn(ffmpeg, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();

      // Avoid unbounded logs.
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();

      reject(
        new Error(
          detail
            ? `FFmpeg failed: ${detail}`
            : `FFmpeg exited with code ${code}`
        )
      );
    });
  });
}

module.exports = async function handler(req, res) {
  let inputFile;
  let outputFile;

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({
        ok: false,
        message: "Method not allowed",
      });
    }

    const rawUrl = String(req.query.url || "").trim();

    if (!rawUrl) {
      return res.status(400).json({
        ok: false,
        message: "Missing url parameter",
      });
    }

    let mediaUrl;

    try {
      mediaUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({
        ok: false,
        message: "Invalid media URL",
      });
    }

    const id =
      `${Date.now()}-` +
      Math.random().toString(36).slice(2);

    inputFile = path.join(
      os.tmpdir(),
      `necrodl-${id}.input`
    );

    outputFile = path.join(
      os.tmpdir(),
      `necrodl-${id}.mp3`
    );

    console.log("[NecroDL MP3] Starting conversion");
    console.log("[NecroDL MP3] Source:", mediaUrl.hostname);

    const {
      response,
      finalUrl,
    } = await fetchWithRedirects(mediaUrl.toString());

    if (!response.ok) {
      throw new Error(
        `Upstream returned HTTP ${response.status}`
      );
    }

    if (!response.body) {
      throw new Error("Upstream response has no body");
    }

    const contentType =
      response.headers.get("content-type") || "";

    console.log(
      "[NecroDL MP3] Content-Type:",
      contentType
    );

    if (/text\/html/i.test(contentType)) {
      throw new Error(
        "The media URL returned HTML instead of media"
      );
    }

    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(inputFile)
    );

    const inputStat = await fsp.stat(inputFile);

    if (!inputStat.size) {
      throw new Error("Downloaded media file is empty");
    }

    console.log(
      "[NecroDL MP3] Input size:",
      inputStat.size
    );

    console.log(
      "[NecroDL MP3] Running FFmpeg..."
    );

    await runFfmpeg(
      inputFile,
      outputFile
    );

    const outputStat = await fsp.stat(outputFile);

    if (!outputStat.size) {
      throw new Error(
        "FFmpeg produced an empty MP3 file"
      );
    }

    const filename = safeFilename(
      req.query.name || "audio.mp3"
    );

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Content-Length",
      String(outputStat.size)
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    console.log(
      "[NecroDL MP3] Sending:",
      filename
    );

    const stream = fs.createReadStream(
      outputFile
    );

    stream.on("error", (error) => {
      console.error(
        "[NecroDL MP3] Stream error:",
        error
      );

      if (!res.headersSent) {
        res.statusCode = 500;
      }

      res.end();
    });

    stream.on("close", async () => {
      await removeFile(inputFile);
      await removeFile(outputFile);

      console.log(
        "[NecroDL MP3] Temporary files cleaned"
      );
    });

    stream.pipe(res);

  } catch (error) {
    console.error(
      "[NecroDL MP3] ERROR:",
      error
    );

    if (inputFile) {
      await removeFile(inputFile);
    }

    if (outputFile) {
      await removeFile(outputFile);
    }

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        message:
          error?.message ||
          "MP3 conversion failed",
      });
    }

    res.end();
  }
};
