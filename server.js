const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SCRIPTS_DIR = path.join(DATA_DIR, "scripts");
const DB_FILE = path.join(DATA_DIR, "scripts.json");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const BOT_CONFIG_FILE = path.join(DATA_DIR, "botconfig.json");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");

const ADMIN_USER_ID = "1485940617342353594";

fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(BOT_CONFIG_FILE)) fs.writeFileSync(BOT_CONFIG_FILE, "{}", "utf8");
if (!fs.existsSync(GUILDS_FILE)) fs.writeFileSync(GUILDS_FILE, "[]", "utf8");

app.use(express.json({ limit: "15mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "kingmor-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1545625902585487370";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "REPLACE_WITH_CLIENT_SECRET";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "http://localhost:3000/auth/discord/callback";

const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  console.error("❌ FATAL: env var API_SECRET is not set!");
  process.exit(1);
}

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function readKeys() {
  try { return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch { return []; }
}
function writeKeys(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
}
function readBotConfig() {
  try { return JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, "utf8")); } catch { return {}; }
}
function writeBotConfig(data) {
  fs.writeFileSync(BOT_CONFIG_FILE, JSON.stringify(data, null, 2));
}
function generateId() {
  return crypto.randomBytes(7).toString("hex");
}
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function getBaseUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}
function checkApiSecret(req) {
  const provided = req.headers["x-api-secret"];
  if (!provided || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(API_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function isAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.id !== ADMIN_USER_ID) {
    return res.status(403).send("Forbidden");
  }
  next();
}
function requireInternalSecret(req, res, next) {
  if (!checkApiSecret(req)) {
    console.warn(`⚠️  Internal API rejected: bad/missing x-api-secret on ${req.method} ${req.originalUrl} from ${req.ip}`);
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ==================== AUTH ====================

app.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingmor - Login</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  min-height: 100vh;
  font-family: Arial, Helvetica, sans-serif;
  color: white;
  background:
    radial-gradient(circle at 10% 0%, rgba(255,200,0,.25), transparent 30%),
    radial-gradient(circle at 90% 100%, rgba(100,100,100,.20), transparent 35%),
    #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  width: 100%;
  max-width: 400px;
  padding: 40px 30px;
  border-radius: 20px;
  border: 1px solid rgba(255,200,0,.25);
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  box-shadow: 0 25px 70px rgba(0,0,0,.5);
  text-align: center;
}
.logo {
  width: 70px; height: 70px; margin: 0 auto 16px;
  border-radius: 20px; display: flex; align-items: center; justify-content: center;
  font-size: 40px; background: linear-gradient(135deg, #ffd700, #ffed4a);
  box-shadow: 0 0 35px rgba(255,200,0,.3);
}
h1 { font-size: 26px; font-weight: 850; margin-bottom: 6px; color: #ffd700; }
p { color: rgba(255,255,255,.55); font-size: 13px; margin-bottom: 30px; }
.discord-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 10px; width: 100%; padding: 14px 20px; border: none; border-radius: 12px;
  background: #5865F2; color: white; font-size: 15px; font-weight: 800;
  cursor: pointer; text-decoration: none; transition: transform .2s, filter .2s;
}
.discord-btn:hover { transform: translateY(-2px); filter: brightness(1.1); }
.discord-btn svg { width: 22px; height: 22px; fill: white; }
.invite-link {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 12px; width: 100%; padding: 12px 20px;
  border: 1px solid rgba(255,200,0,.3); border-radius: 12px;
  background: rgba(255,200,0,.1); color: rgba(255,255,255,.75);
  font-size: 13px; font-weight: 700; text-decoration: none;
  transition: background .2s, border-color .2s;
}
.invite-link:hover { background: rgba(255,200,0,.2); border-color: rgba(255,200,0,.6); color: #ffd700; }
.invite-link svg { width: 16px; height: 16px; fill: currentColor; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">👑</div>
  <h1>Kingmor</h1>
  <p>Login with Discord to protect your Lua scripts.</p>
  <a class="discord-btn" href="/auth/discord">
    <svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
    Login with Discord
  </a>
  <a class="invite-link" href="https://discord.com/oauth2/authorize?client_id=1545625902585487370&permissions=2952873984&integration_type=0&scope=bot" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
    Invite Bot to Discord Server
  </a>
</div>
</body>
</html>`);
});

app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login");
  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token } = tokenRes.data;
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const discordUser = userRes.data;
    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    };
    res.redirect("/");
  } catch (err) {
    console.error("Discord OAuth error:", err?.response?.data || err.message);
    res.redirect("/login?error=1");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ==================== API SCRIPTS ====================

app.get("/api/scripts", requireAuth, (req, res) => {
  const db = readDB();
  const userId = req.session.user.id;
  res.json(
    db
      .filter((s) => s.ownerId === userId)
      .map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, createdAt: s.createdAt }))
  );
});

app.get("/api/scripts/internal", requireInternalSecret, (req, res) => {
  const db = readDB();
  const ownerId = req.query.ownerId;
  const filtered = ownerId ? db.filter((s) => String(s.ownerId) === String(ownerId)) : db;
  res.json(
    filtered.map((s) => ({
      id: s.id, name: s.name, enabled: s.enabled,
      ownerId: s.ownerId, ownerUsername: s.ownerUsername, guildId: s.guildId,
    }))
  );
});

// Endpoint baru: ambil script by scriptId (untuk lookup owner saat whitelist)
app.get("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  res.json({
    id: script.id, name: script.name, enabled: script.enabled,
    ownerId: script.ownerId, ownerUsername: script.ownerUsername, guildId: script.guildId,
  });
});

app.post("/api/scripts", requireAuth, (req, res) => {
  const { name, source, guildId } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Script name is required" });
  if (!source || typeof source !== "string") return res.status(400).json({ error: "Lua source is required" });
  if (source.length > 10 * 1024 * 1024) return res.status(413).json({ error: "File too large. Maximum 10MB." });

  const id = generateId();
  const filename = `${id}.lua`;
  fs.writeFileSync(path.join(SCRIPTS_DIR, filename), source, "utf8");

  const script = {
    id, name: name.trim().slice(0, 100), filename, enabled: true,
    ownerId: String(req.session.user.id), ownerUsername: req.session.user.username,
    guildId: guildId || null, createdAt: new Date().toISOString(),
  };

  const db = readDB();
  db.push(script);
  writeDB(db);

  console.log(`✅ Script created: "${script.name}" (${script.id}) by ${script.ownerId}`);

  const base = getBaseUrl(req);
  res.json({
    success: true,
    script: { id: script.id, name: script.name, enabled: script.enabled, createdAt: script.createdAt },
    loader: `${base}/api/loader/${id}.lua`,
  });
});

app.post("/api/scripts/:id/toggle", requireAuth, (req, res) => {
  const db = readDB();
  const script = db.find((x) => x.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  if (script.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  script.enabled = !script.enabled;
  writeDB(db);
  res.json({ success: true, enabled: script.enabled });
});

app.delete("/api/scripts/:id", requireAuth, (req, res) => {
  const db = readDB();
  const index = db.findIndex((x) => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Script not found" });
  if (db[index].ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  const script = db[index];
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  db.splice(index, 1);
  writeDB(db);
  res.json({ success: true });
});

app.delete("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const requestOwnerId = req.headers["x-owner-id"];
  if (!requestOwnerId) return res.status(400).json({ error: "x-owner-id header required" });
  const db = readDB();
  const index = db.findIndex((x) => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Script not found" });
  if (String(db[index].ownerId) !== String(requestOwnerId)) return res.status(403).json({ error: "You do not own this script" });
  const script = db[index];
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  db.splice(index, 1);
  writeDB(db);
  res.json({ success: true, name: script.name });
});

// ==================== HWID ENDPOINTS ====================

app.get("/api/hwid/check", (req, res) => {
  const { scriptId, key, hwid } = req.query;

  if (!scriptId || !hwid) {
    return res.type("application/json").json({ valid: false, reason: "Missing params" });
  }

  const botConfig = readBotConfig();
  const isFreeMode = !!(botConfig[req.query.guildId]?.freeMode?.[scriptId]) ||
    Object.values(botConfig).some(g => g?.freeMode?.[scriptId] === true);

  if (isFreeMode) {
    triggerWebhookAsync({ scriptId, key: null, hwid, userId: null, username: null });
    return res.json({ valid: true, freeMode: true });
  }

  if (!key) {
    return res.json({ valid: false, reason: "No Key Provided" });
  }

  const keys = readKeys();
  const keyData = keys.find(k => k.key === key.toLowerCase().trim() && k.scriptId === scriptId);

  if (!keyData) return res.json({ valid: false, reason: "Invalid Key" });
  if (keyData.expiry && new Date(keyData.expiry) < new Date()) {
    return res.json({ valid: false, reason: "Key Expired" });
  }

  if (!keyData.hwid) {
    keyData.hwid = hwid;
    writeKeys(keys);
    triggerWebhookAsync({ scriptId, key: keyData.key, hwid, userId: keyData.userId, username: keyData.username });
    return res.json({ valid: true, bound: true });
  }

  if (keyData.hwid !== hwid) {
    return res.json({ valid: false, reason: "HWID Mismatch - Contact Admin" });
  }

  triggerWebhookAsync({ scriptId, key: keyData.key, hwid, userId: keyData.userId, username: keyData.username });
  return res.json({ valid: true });
});

app.post("/api/hwid/reset", requireInternalSecret, (req, res) => {
  const { userId, scriptId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const keys = readKeys();
  let resetCount = 0;

  const updated = keys.map(k => {
    const isOwner = String(k.userId) === String(userId);
    const isScript = scriptId ? k.scriptId === scriptId : true;
    if (isOwner && isScript && k.hwid) {
      resetCount++;
      return { ...k, hwid: null };
    }
    return k;
  });

  writeKeys(updated);
  res.json({ success: true, resetCount });
});

// ==================== WEBHOOK ENDPOINTS ====================

async function triggerWebhookAsync({ scriptId, key, hwid, userId, username }) {
  try {
    const botConfig = readBotConfig();
    const webhookUrl = botConfig.webhooks?.[scriptId];
    if (!webhookUrl) return;

    const db = readDB();
    const script = db.find(s => s.id === scriptId);
    const scriptName = script ? script.name : scriptId;

    const userField = userId ? `<@${userId}>` : (username || "Unknown");

    await axios.post(webhookUrl, {
      embeds: [{
        title: "👑 Script Executed",
        color: 0xFFD700,
        fields: [
          { name: "📜 Script", value: scriptName, inline: false },
          { name: "👤 Discord User", value: userField, inline: true },
          { name: "🔑 Key", value: key ? `\`${key}\`` : "Free Mode", inline: true },
          { name: "🖥️ HWID", value: hwid || "Not provided", inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Kingmor 👑" },
      }]
    }, { timeout: 5000 });
  } catch (err) {
    console.error(`❌ Webhook trigger error (script: ${scriptId}): ${err.message}`);
  }
}

app.get("/api/webhook/get", requireInternalSecret, (req, res) => {
  const { scriptId } = req.query;
  if (!scriptId) return res.status(400).json({ error: "scriptId required" });
  const botConfig = readBotConfig();
  res.json({ webhook: botConfig.webhooks?.[scriptId] || null });
});

app.post("/api/webhook/set", requireInternalSecret, (req, res) => {
  const { scriptId, url } = req.body;
  if (!scriptId || !url) return res.status(400).json({ error: "scriptId and url required" });
  const botConfig = readBotConfig();
  if (!botConfig.webhooks) botConfig.webhooks = {};
  botConfig.webhooks[scriptId] = url;
  writeBotConfig(botConfig);
  res.json({ success: true });
});

app.delete("/api/webhook/delete", requireInternalSecret, (req, res) => {
  const { scriptId } = req.body;
  if (!scriptId) return res.status(400).json({ error: "scriptId required" });
  const botConfig = readBotConfig();
  if (botConfig.webhooks?.[scriptId]) {
    delete botConfig.webhooks[scriptId];
    writeBotConfig(botConfig);
  }
  res.json({ success: true });
});

// ==================== LOADER ENDPOINT ====================

app.get("/api/loader/:id.lua", (req, res) => {
  const scriptId = req.params.id;
  const db = readDB();
  const script = db.find((x) => x.id === scriptId);

  if (!script) {
    return res.status(404).type("text/plain").send("-- Kingmor: Script not found");
  }

  const botConfig = readBotConfig();
  const isFreeMode = Object.values(botConfig).some(g => g?.freeMode?.[scriptId] === true);
  const base = getBaseUrl(req);

  function kickPlayer(reason) {
    return `local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
if LocalPlayer then
    LocalPlayer:Kick("[Kingmor] ${reason}")
end
return`;
  }

  function buildHwidWrapper(sourceCode, keyValue, freeModeFlag) {
    if (freeModeFlag) {
      return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer

local _km_hwid = ""
local _km_ok, _km_id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if _km_ok then _km_hwid = tostring(_km_id) end

-- Send webhook notification (free mode, does not block)
pcall(function()
    game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _km_hwid)
end)

-- User script
${sourceCode}`;
    }

    return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer

local _km_hwid = ""
local _km_ok, _km_id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if _km_ok then _km_hwid = tostring(_km_id) end

local _km_key = "${keyValue}"
local _km_checkUrl = "${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _km_key .. "&hwid=" .. _km_hwid

local _km_success, _km_body = pcall(function()
    return game:HttpGet(_km_checkUrl)
end)

if not _km_success or not _km_body then
    _km_lp:Kick("[Kingmor] HWID Check Failed")
    return
end

local _km_data = _km_HttpService:JSONDecode(_km_body)
if not _km_data or not _km_data.valid then
    local _km_reason = (type(_km_data) == "table" and _km_data.reason) or "Invalid Key"
    _km_lp:Kick("[Kingmor] " .. _km_reason)
    return
end

-- User script
${sourceCode}`;
  }

  const userAgent = req.headers["user-agent"] || "";
  const isRobloxRequest = userAgent.includes("Roblox") || userAgent.includes("Lua")
    || userAgent.includes("Synapse") || userAgent.includes("Krnl")
    || userAgent.includes("Fluxus") || userAgent.includes("Hydrogen")
    || userAgent.includes("ScriptWare") || userAgent.includes("Electron");

  if (isRobloxRequest) {
    if (!script.enabled) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Script Disabled"));
    }

    const fp = path.join(SCRIPTS_DIR, script.filename);
    if (!fs.existsSync(fp)) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Source Missing"));
    }

    const sourceCode = fs.readFileSync(fp, "utf8");

    if (isFreeMode) {
      const wrapped = buildHwidWrapper(sourceCode, "", true);
      return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(wrapped);
    }

    const providedKey = (req.query.key || "").toLowerCase().trim();
    if (!providedKey) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("No Key Provided"));
    }

    const allKeys = readKeys();
    const keyData = allKeys.find(k => k.key === providedKey && k.scriptId === scriptId);

    if (!keyData) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Invalid Key"));
    }

    if (keyData.expiry && new Date(keyData.expiry) < new Date()) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Key Expired"));
    }

    const wrapped = buildHwidWrapper(sourceCode, providedKey, false);
    return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(wrapped);
  }

  // ── Browser request: show loader page ──
  const uid = req.query.uid || null;
  let userScriptKey = null;
  if (!isFreeMode && uid) {
    const allKeys = readKeys();
    const userKey = allKeys.find(k => String(k.userId) === String(uid) && k.scriptId === scriptId);
    if (userKey) {
      const isExpired = userKey.expiry && new Date(userKey.expiry) < new Date();
      if (!isExpired) userScriptKey = userKey.key;
    }
  }

  const loaderDisplay = isFreeMode
    ? `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`
    : userScriptKey
      ? `script_key = "${userScriptKey}"\nloadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua?key="..script_key))()`
      : `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`;

  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kingmor • ${escapeHtml(script.name)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  min-height: 100vh; font-family: 'Segoe UI', Arial, sans-serif;
  background: radial-gradient(circle at 10% 0%, rgba(255,200,0,0.20), transparent 35%),
              radial-gradient(circle at 90% 100%, rgba(100,100,100,0.15), transparent 35%), #0a0a0a;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.card {
  max-width: 650px; width: 100%; padding: 35px 30px; border-radius: 20px;
  border: 1px solid rgba(255,200,0,0.25);
  background: linear-gradient(145deg, rgba(30,30,30,0.95), rgba(15,15,15,0.98));
  box-shadow: 0 25px 70px rgba(0,0,0,0.6); text-align: center;
}
.logo {
  width: 60px; height: 60px; margin: 0 auto 14px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center; font-size: 36px;
  background: linear-gradient(135deg, #ffd700, #ffed4a); box-shadow: 0 0 35px rgba(255,200,0,0.3);
}
h1 { font-size: 24px; font-weight: 850; color: #ffd700; margin-bottom: 4px; }
.subtitle { color: rgba(255,255,255,0.5); font-size: 12px; margin-bottom: 20px; }
.protected-badge {
  display: inline-block; background: linear-gradient(90deg, #ffd700, #8a6d00);
  padding: 4px 16px; border-radius: 20px; font-size: 11px; font-weight: 800;
  color: #0a0a0a; letter-spacing: 1px; margin-bottom: 18px;
}
.script-name { color: rgba(255,255,255,0.7); font-size: 13px; margin-bottom: 18px; }
.script-name span { color: #ffd700; font-weight: 700; }
.loader-label {
  text-align: left; font-size: 11px; font-weight: 800; letter-spacing: 1px;
  color: rgba(255,255,255,0.4); margin-bottom: 6px; text-transform: uppercase;
}
.code-block {
  width: 100%; background: #000; border-radius: 12px;
  border: 1px solid rgba(255,200,0,0.15); padding: 16px 18px;
  overflow-x: auto; text-align: left; box-shadow: inset 0 0 30px rgba(0,0,0,0.4);
}
.code-block code {
  font-family: 'Courier New', monospace; font-size: 13px; color: #ffd700;
  white-space: pre; word-break: break-all; display: block;
}
.copy-btn {
  width: 100%; margin-top: 12px; padding: 13px; border: none; border-radius: 11px;
  cursor: pointer; font-size: 14px; font-weight: 800; color: #0a0a0a;
  background: linear-gradient(90deg, #ffd700, #ffed4a);
  transition: transform 0.2s, filter 0.2s;
}
.copy-btn:hover { transform: translateY(-2px); filter: brightness(1.05); }
.footer-text { margin-top: 16px; font-size: 11px; color: rgba(255,255,255,0.25); }
.footer-text strong { color: #ffd700; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">👑</div>
  <h1>Kingmor</h1>
  <div class="subtitle">Lua Protection System</div>
  <div class="protected-badge">👑 SOURCE PROTECTED</div>
  <div class="script-name">SCRIPT: <span>${escapeHtml(script.name)}</span></div>
  <div class="loader-label">📜 LOADER</div>
  <div class="code-block">
    <code id="loaderCode">${escapeHtml(loaderDisplay)}</code>
  </div>
  <button class="copy-btn" onclick="copyLoader()">📋 Copy Loader</button>
  <div class="footer-text">Protected by <strong>Kingmor</strong> 👑</div>
</div>
<script>
const loader = ${JSON.stringify(loaderDisplay)};
async function copyLoader() {
  const btn = document.querySelector(".copy-btn");
  try {
    await navigator.clipboard.writeText(loader);
    btn.textContent = "✅ Copied!";
    setTimeout(() => { btn.textContent = "📋 Copy Loader"; }, 1800);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = loader; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    btn.textContent = "✅ Copied!";
    setTimeout(() => { btn.textContent = "📋 Copy Loader"; }, 1800);
  }
}
</script>
</body>
</html>`);
});

// ==================== FILES LOADER (redirect) ====================
app.get("/files/loaders/:id.lua", (req, res) => {
  res.redirect(`/api/loader/${req.params.id}.lua`);
});

// ==================== FREEMODE ====================

app.get("/api/freemode/:guildId/:scriptId", requireInternalSecret, (req, res) => {
  const { guildId, scriptId } = req.params;
  const botConfig = readBotConfig();
  res.json({ freeMode: botConfig[guildId]?.freeMode?.[scriptId] === true });
});

app.post("/api/freemode/update", requireInternalSecret, (req, res) => {
  const { guildId, scriptId, enabled } = req.body;
  if (!guildId || !scriptId) return res.status(400).json({ error: "guildId and scriptId are required" });
  const botConfig = readBotConfig();
  if (!botConfig[guildId]) botConfig[guildId] = {};
  if (!botConfig[guildId].freeMode) botConfig[guildId].freeMode = {};
  if (enabled) {
    botConfig[guildId].freeMode[scriptId] = true;
  } else {
    delete botConfig[guildId].freeMode[scriptId];
  }
  writeBotConfig(botConfig);
  res.json({ success: true, freeMode: enabled });
});

// ==================== ADMIN API ====================

app.get("/api/admin/guilds", isAdmin, (req, res) => {
  let guilds = [];
  if (fs.existsSync(GUILDS_FILE)) {
    try { guilds = JSON.parse(fs.readFileSync(GUILDS_FILE, "utf8")); } catch {}
  }
  res.json(guilds);
});

app.post("/api/admin/guilds/update", requireInternalSecret, (req, res) => {
  const { guilds } = req.body;
  if (!guilds || !Array.isArray(guilds)) return res.status(400).json({ error: "Invalid guilds data" });
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(guilds, null, 2));
  res.json({ success: true });
});

app.get("/api/admin/scripts", isAdmin, (req, res) => {
  const db = readDB();
  res.json(db.map(script => {
    const filepath = path.join(SCRIPTS_DIR, script.filename);
    return { ...script, source: fs.existsSync(filepath) ? fs.readFileSync(filepath, "utf8") : null };
  }));
});

// ==================== ADMIN PAGES ====================

app.get("/admin/dashboard", isAdmin, (req, res) => {
  const db = readDB();
  const keys = readKeys();
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingmor Admin Dashboard</title>
<style>
* { box-sizing: border-box; margin:0; padding:0; }
body { min-height:100vh; font-family: Arial, sans-serif; background: #0a0a0a; color: white;
  display:flex; align-items:center; justify-content:center; }
.card { max-width:600px; width:100%; padding:40px; border-radius:20px;
  border:1px solid rgba(255,200,0,.25);
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  box-shadow: 0 25px 70px rgba(0,0,0,.5); }
h1 { margin-bottom:20px; text-align:center; color: #ffd700; }
.stat { display:flex; justify-content:space-between; padding:12px 0;
  border-bottom:1px solid rgba(255,255,255,.08); }
.stat:last-child { border-bottom:none; }
.label { color: rgba(255,255,255,.55); }
.value { font-weight:bold; color: #ffd700; }
.back { display:inline-block; margin-top:25px; padding:10px 20px; border-radius:8px;
  background: #ffd700; color:#0a0a0a; text-decoration:none; font-weight:bold; }
</style>
</head>
<body>
<div class="card">
  <h1>👑 Kingmor Admin Dashboard</h1>
  <div class="stat"><span class="label">Total Scripts</span><span class="value">${db.length}</span></div>
  <div class="stat"><span class="label">Total Users</span><span class="value">${new Set(db.map(s => s.ownerId)).size}</span></div>
  <div class="stat"><span class="label">Total Keys</span><span class="value">${keys.length}</span></div>
  <div class="stat"><span class="label">Enabled Scripts</span><span class="value">${db.filter(s => s.enabled).length}</span></div>
  <div style="text-align:center;"><a class="back" href="/">⬅ Back to Dashboard</a></div>
</div>
</body>
</html>`);
});

// ==================== MAIN DASHBOARD ====================

app.get("/", requireAuth, (req, res) => {
  const db = readDB();
  const userId = req.session.user.id;
  const user = req.session.user;
  const userScripts = db.filter(s => s.ownerId === userId);
  const totalKeys = readKeys().filter(k => k.createdBy === userId).length;

  const cards = userScripts.map(script => {
    const base = getBaseUrl(req);
    const loaderPage = `${base}/api/loader/${script.id}.lua`;
    const loaderCodeDisplay = `loadstring(game:HttpGet("${base}/api/loader/${script.id}.lua"))()`;
    return `
<div class="script-card">
<div class="script-info">
    <div class="script-icon">👑</div>
    <div>
        <div class="script-name">${escapeHtml(script.name)}</div>
        <div class="script-status ${script.enabled ? "on" : "off"}">
            ${script.enabled ? "● Enabled" : "● Disabled"}
        </div>
    </div>
</div>
<div class="script-menu">
    <button class="dots" onclick="toggleMenu('${script.id}')">⋮</button>
    <div class="menu" id="menu-${script.id}">
        <button onclick="openStats()">📊 Dashboard</button>
        <button onclick='openLoader(${JSON.stringify(loaderPage)})'>👑 Open Loader</button>
        <button onclick='copyLoaderCode(${JSON.stringify(loaderCodeDisplay)})'>📋 Copy Loader</button>
        <button onclick="toggleScript('${script.id}')">
            ${script.enabled ? "⏸ Disable" : "▶ Enable"}
        </button>
        <button class="delete" onclick="deleteScript('${script.id}')">🗑 Delete</button>
    </div>
</div>
</div>`;
  }).join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingmor</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { min-height: 100vh; font-family: Arial, Helvetica, sans-serif; color: white;
  background: radial-gradient(circle at 10% 0%, rgba(255,200,0,.20), transparent 30%),
              radial-gradient(circle at 90% 100%, rgba(100,100,100,.15), transparent 35%), #0a0a0a; }
.header { padding: 20px 30px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid rgba(255,200,0,.2);
  background: linear-gradient(90deg, #8a6d00, #ffd700, #0a0a0a); }
.brand { display: flex; align-items: center; gap: 12px; }
.logo { width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;
  border-radius: 13px; background: #ffd700; color: #0a0a0a; font-size: 25px;
  box-shadow: 0 0 25px rgba(255,200,0,.3); }
.brand h1 { font-size: 23px; font-weight: 800; color: #0a0a0a; }
.brand span { display: block; margin-top: 3px; color: rgba(0,0,0,.65); font-size: 11px; }
.user-info { display: flex; align-items: center; gap: 10px; }
.user-avatar { width: 36px; height: 36px; border-radius: 50%; border: 2px solid #ffd700; }
.user-name { font-size: 13px; font-weight: 700; color: #0a0a0a; }
.logout-btn { padding: 7px 14px; border: 1px solid rgba(0,0,0,.3); border-radius: 8px;
  background: transparent; color: rgba(0,0,0,.7); font-size: 12px; cursor: pointer; text-decoration: none; }
.invite-btn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px;
  border: none; border-radius: 8px; background: #5865F2; color: white;
  font-size: 12px; font-weight: 700; cursor: pointer; text-decoration: none; }
.container { width: min(1100px, calc(100% - 30px)); margin: 35px auto; }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; }
.stat-card { padding: 20px; border-radius: 15px;
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  border: 1px solid rgba(255,200,0,.2); text-align: center; }
.stat-card .value { font-size: 28px; font-weight: 850; color: #ffd700; }
.stat-card .label { font-size: 12px; color: rgba(255,255,255,.5); margin-top: 5px; }
.hero { padding: 28px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(255,200,0,.10), rgba(100,100,100,.05));
  border: 1px solid rgba(255,200,0,.2); }
.hero h2 { font-size: 27px; margin-bottom: 8px; color: #ffd700; }
.hero p { color: #aaa; font-size: 14px; }
.form-grid { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
input, textarea { width: 100%; outline: none; border: 1px solid rgba(255,200,0,.2);
  border-radius: 11px; background: #1a1a1a; color: white; padding: 13px; font-family: inherit; }
textarea { grid-column: 1 / -1; min-height: 180px; resize: vertical; }
.file-row { display: flex; align-items: center; gap: 10px; grid-column: 1 / -1; }
.file-label { display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 18px; border-radius: 11px; background: #ffd700; color: #0a0a0a;
  font-size: 13px; font-weight: 800; cursor: pointer; }
.file-name { color: #888; font-size: 12px; }
#fileInput { display: none; }
.upload-button { grid-column: 1 / -1; width: 100%; padding: 14px; border: none; border-radius: 11px;
  background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a; font-weight: 800; cursor: pointer; }
.section-title { margin: 25px 0 12px; color: #aaa; font-size: 15px; }
.scripts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px,1fr)); gap: 15px; }
.script-card { position: relative; display: flex; align-items: center; justify-content: space-between;
  padding: 18px; border-radius: 17px; background: linear-gradient(145deg, #1a1a1a, #0d0d0d);
  border: 1px solid rgba(255,200,0,.15); }
.script-info { display: flex; align-items: center; gap: 13px; }
.script-icon { width: 45px; height: 45px; display: flex; align-items: center; justify-content: center;
  border-radius: 12px; background: linear-gradient(135deg, #ffd700, #ffed4a); font-size: 22px; }
.script-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 15px; font-weight: 700; }
.script-status { margin-top: 4px; font-size: 11px; }
.script-status.on { color: #54ff88; }
.script-status.off { color: #ff4d4d; }
.script-menu { position: relative; }
.dots { width: 38px; height: 38px; border: none; border-radius: 10px; background: #1c1c1c;
  color: #ffd700; font-size: 23px; cursor: pointer; }
.menu { display: none; position: absolute; z-index: 100; right: 0; top: 45px; width: 180px;
  padding: 6px; border-radius: 12px; background: #1a1a1a;
  border: 1px solid rgba(255,200,0,.2); box-shadow: 0 15px 40px rgba(0,0,0,.6); }
.menu.show { display: block; }
.menu button { width: 100%; padding: 10px; border: none; border-radius: 8px;
  background: transparent; color: #eee; text-align: left; cursor: pointer; }
.menu button:hover { background: #2a2a2a; color: #ffd700; }
.menu .delete { color: #ff4d4d; }
.empty { padding: 50px; text-align: center; color: #666;
  border: 1px dashed rgba(255,200,0,.2); border-radius: 18px; }
@media(max-width:700px) {
  .header { padding: 18px; }
  .user-name { display: none; }
  .container { width: calc(100% - 20px); margin-top: 20px; }
  .form-grid { grid-template-columns: 1fr; }
  textarea, .upload-button { grid-column: auto; }
}
</style>
</head>
<body>
<header class="header">
  <div class="brand">
    <div class="logo">👑</div>
    <div><h1>Kingmor</h1><span>Lua Protection System</span></div>
  </div>
  <div class="user-info">
    <img class="user-avatar" src="${escapeHtml(user.avatar)}" alt="avatar">
    <span class="user-name">${escapeHtml(user.username)}</span>
    <a class="invite-btn" href="https://discord.com/oauth2/authorize?client_id=1545625902585487370&permissions=2952873984&integration_type=0&scope=bot" target="_blank" rel="noopener">Invite Bot</a>
    <a class="logout-btn" href="/logout">Logout</a>
  </div>
</header>
<main class="container">
  <div class="stats-row">
    <div class="stat-card"><div class="value">${userScripts.length}</div><div class="label">Total Scripts</div></div>
    <div class="stat-card"><div class="value">${userScripts.filter(s => s.enabled).length}</div><div class="label">Enabled Scripts</div></div>
    <div class="stat-card"><div class="value">${totalKeys}</div><div class="label">Total Keys</div></div>
  </div>
  <section class="hero">
    <h2>👑 Protect Your Scripts</h2>
    <p>Upload a Lua/TXT file or paste your source manually.</p>
    <div class="form-grid">
      <input id="scriptName" placeholder="Script name...">
      <div class="file-row">
        <label class="file-label" for="fileInput">📁 Upload File</label>
        <input id="fileInput" type="file" accept=".lua,.txt,text/plain">
        <span class="file-name" id="fileName">No file selected</span>
      </div>
      <textarea id="scriptSource" placeholder="Paste your Lua source here..."></textarea>
      <button class="upload-button" onclick="uploadScript()">👑 Protect &amp; Upload</button>
    </div>
  </section>
  <div class="section-title">Your Scripts</div>
  <section class="scripts">
    ${cards || `<div class="empty">👑 No scripts yet.<br>Upload your first Lua script above.</div>`}
  </section>
</main>
<script>
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const scriptName = document.getElementById("scriptName");
const scriptSource = document.getElementById("scriptSource");

fileInput.addEventListener("change", function() {
  const file = this.files[0];
  if (!file) return;
  const fn = file.name.toLowerCase();
  if (!fn.endsWith(".lua") && !fn.endsWith(".txt")) {
    alert("Only .lua or .txt files are allowed!"); this.value = ""; return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("Maximum file size is 10MB."); this.value = ""; return;
  }
  fileName.textContent = file.name;
  scriptName.value = file.name.replace(/\.(lua|txt)$/i, "");
  const reader = new FileReader();
  reader.onload = e => { scriptSource.value = e.target.result; };
  reader.readAsText(file);
});

function toggleMenu(id) {
  document.querySelectorAll(".menu").forEach(m => m.classList.remove("show"));
  const menu = document.getElementById("menu-" + id);
  if (menu) menu.classList.toggle("show");
}
document.addEventListener("click", e => {
  if (!e.target.closest(".script-menu")) document.querySelectorAll(".menu").forEach(m => m.classList.remove("show"));
});

async function uploadScript() {
  const name = scriptName.value.trim();
  const source = scriptSource.value;
  if (!name) { alert("Enter script name!"); return; }
  if (!source.trim()) { alert("Enter Lua source!"); return; }
  try {
    const r = await fetch("/api/scripts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, source })
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Upload failed"); return; }
    location.reload();
  } catch { alert("Server error!"); }
}

async function toggleScript(id) {
  const r = await fetch("/api/scripts/" + id + "/toggle", { method: "POST" });
  if (r.ok) location.reload(); else alert("Failed to change status");
}

async function deleteScript(id) {
  if (!confirm("Delete this script?")) return;
  const r = await fetch("/api/scripts/" + id, { method: "DELETE" });
  if (r.ok) location.reload(); else alert("Delete failed");
}

async function copyLoaderCode(loaderCode) {
  try { await navigator.clipboard.writeText(loaderCode); alert("Loader copied!"); }
  catch { alert("Failed to copy loader"); }
}

function openLoader(url) { window.open(url, "_blank"); }
function openStats() { window.scrollTo(0, 0); }
</script>
</body>
</html>`);
});

// ==================== HEALTH CHECK ====================
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`Kingmor running on port ${PORT}`);
  console.log(`API_SECRET loaded: ${API_SECRET ? "yes (" + API_SECRET.length + " chars)" : "NO"}`);
});
