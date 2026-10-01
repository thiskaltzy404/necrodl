// POST /api/resolve  { url, format? }  ->  { ok, platform, result }
const scrapr = require("../scrapr");

const PLATFORMS = [
  [/(^|\.)tiktok\.com$/, "tiktok", [["tiktok", "snaptik"], ["tiktok", "tiktokio"], ["tiktok", "ssstik"]]],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube", [["youtube", "ytmp3"], ["youtube", "ytmp3gg"]]],
  [/(^|\.)instagram\.com$/, "instagram", [["instagram", "direct"], ["instagram", "indown"], ["instagram", "snapsave"]]],
  [/(^|\.)(twitter\.com|x\.com)$/, "twitter", [["twitter", "direct"], ["twitter", "tweeload"]]],
  [/(^|\.)(facebook\.com|fb\.watch)$/, "facebook", [["facebook", "snapsave"]]],
  [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, "pinterest", [["pinterest", "direct"], ["pinterest", "pindown"]]],
  [/(^|\.)spotify\.com$/, "spotify", [["spotify", "spotisaver"], ["spotify", "spotidown"]]],
  [/(^|\.)soundcloud\.com$/, "soundcloud", [["soundcloud", "klickaud"]]],
  [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, "reddit", [["reddit", "rapidsave"]]],
  [/(^|\.)(douyin\.com|iesdouyin\.com)$/, "douyin", [["douyin", "direct"]]],
  [/(^|\.)(bilibili\.com|bilibili\.tv|b23\.tv)$/, "bilibili", [["bilibili", "direct"]]],
  [/(^|\.)pixiv\.net$/, "pixiv", [["pixiv", "ajax"]]],
  [/(^|\.)(xiaohongshu\.com|xhslink\.com|rednote\.com)$/, "rednote", [["rednote", "direct"]]],
  [/(^|\.)(terabox\.com|1024terabox\.com|teraboxapp\.com)$/, "terabox", [["terabox", "sechno"]]],
  [/(^|\.)music\.apple\.com$/, "applemusic", [["applemusic", "aplmate"]]],
];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = req.method === "POST" ? req.body || {} : req.query || {};
  let target;
  try {
    target = new URL(String(input.url || "").trim());
    if (!/^https?:$/.test(target.protocol)) throw 0;
  } catch {
    return res.status(400).json({ ok: false, message: "Enter a valid link that starts with https://" });
  }

  const hit = PLATFORMS.find(([re]) => re.test(target.hostname.toLowerCase()));
  if (!hit) return res.status(422).json({ ok: false, message: "This website is not supported yet." });
  const [, platform, chain] = hit;
  const format = input.format === "mp3" ? "mp3" : "mp4";

  let lastError = "No download links found.";
  for (const [group, method] of chain) {
    try {
      const out = await scrapr[group][method](target.href, platform === "youtube" ? format : undefined);
      const downloads = ((out && out.result && out.result.downloads) || []).filter((d) => d && d.url);
      if (out && out.status && downloads.length) {
        return res.status(200).json({
          ok: true,
          platform,
          result: {
            title: out.result.title || "Untitled",
            author: out.result.author || "",
            thumbnail: out.result.thumbnail || "",
            type: out.result.type || "video",
            downloads: downloads.map((d) => ({
              url: d.url,
              type: d.type || out.result.type || "video",
              quality: d.quality || d.format || "",
              format: d.format || "",
            })),
          },
        });
      }
      if (out && out.message) lastError = out.message;
    } catch (e) {
      lastError = e.message || lastError;
    }
  }
  return res.status(502).json({ ok: false, message: "Could not get this media. " + lastError });
};
