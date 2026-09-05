const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CONFIG = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID || "1545625902585487370",
  apiBase: process.env.API_BASE,
  apiSecret: process.env.API_SECRET
};

const missing = [];
if (!CONFIG.token) missing.push("BOT_TOKEN");
if (!CONFIG.apiBase) missing.push("API_BASE");
if (!CONFIG.apiSecret) missing.push("API_SECRET");

if (missing.length > 0) {
  console.error(`❌ FATAL: env var berikut belum di-set: ${missing.join(", ")}`);
  process.exit(1);
}

CONFIG.apiBase = CONFIG.apiBase.replace(/\/+$/, "");

const DATA_DIR = path.join(__dirname, "data");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const CONFIG_FILE = path.join(DATA_DIR, "botconfig.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, "{}", "utf8");
if (!fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, "[]", "utf8");

function readKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch { return []; } }
function writeKeys(data) { fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2)); }
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; } }
function writeConfig(data) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2)); }
function readBlacklist() { try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8")); } catch { return []; } }
function writeBlacklist(data) { fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2)); }

function isBlacklisted(userId) {
  return readBlacklist().some(b => String(b.userId) === String(userId));
}

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 40 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function hasPermission(member, guildId) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = readConfig();
  const roleId = cfg[guildId]?.whitelistRole;
  if (!roleId) return false;
  return member.roles.cache.has(roleId);
}

const internalHeaders = { "x-api-secret": CONFIG.apiSecret };

const scriptCache = new Map();
const CACHE_TTL = 30000;

const panelTempData = new Map();
const buyerRoleTempData = new Map();
const freeModeTempData = new Map();
const webhookTempData = new Map(); // untuk /setwebhook

function describeAxiosError(err) {
  if (err.response) return `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`;
  if (err.request) return `Tidak ada response dari server: ${err.code || err.message}`;
  return err.message;
}

async function getScriptsByOwner(ownerId, { bypassCache = false } = {}) {
  const cacheKey = `scripts_${ownerId}`;
  const cached = scriptCache.get(cacheKey);
  if (!bypassCache && cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.data;
  try {
    const res = await axios.get(`${CONFIG.apiBase}/api/scripts/internal`, {
      headers: internalHeaders, params: { ownerId }, timeout: 8000
    });
    const data = res.data || [];
    scriptCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.error(`❌ getScriptsByOwner(${ownerId}) gagal: ${describeAxiosError(err)}`);
    if (cached) {
      console.warn(`⚠️  Pakai cache lama untuk ownerId ${ownerId}`);
      return cached.data;
    }
    return [];
  }
}

function clearCache(ownerId) {
  if (ownerId) scriptCache.delete(`scripts_${ownerId}`);
  else scriptCache.clear();
}

async function updateGuildsList() {
  try {
    const guilds = client.guilds.cache.map(g => ({
      id: g.id, name: g.name, icon: g.icon, memberCount: g.memberCount
    }));
    await axios.post(`${CONFIG.apiBase}/api/admin/guilds/update`,
      { guilds }, { headers: internalHeaders, timeout: 8000 }
    );
    console.log(`✅ Updated guilds list: ${guilds.length} guilds`);
  } catch (err) {
    console.error(`❌ Failed to update guilds list: ${describeAxiosError(err)}`);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder()
    .setName("setuppanel")
    .setDescription("Setup panel embed with script selection")
    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Description").setRequired(true)),

  new SlashCommandBuilder()
    .setName("whitelistrole")
    .setDescription("Set admin role")
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setbuyerrole")
    .setDescription("Set buyer role for specific script")
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("genkey")
    .setDescription("Generate key")
    .addIntegerOption(o => o.setName("days").setDescription("Duration in days (0=lifetime)").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Number of keys").setRequired(false)),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist user/role for a script")
    .addIntegerOption(o => o.setName("days").setDescription("Duration in days (0=lifetime)").setRequired(true))
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(false)),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist user")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Unblacklist user")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke key/user")
    .addStringOption(o => o.setName("key").setDescription("Key").setRequired(false))
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),

  new SlashCommandBuilder()
    .setName("listkeys")
    .setDescription("View all keys"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View user info")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletescript")
    .setDescription("Delete your script from Kingmor"),

  new SlashCommandBuilder()
    .setName("freemode")
    .setDescription("Enable or disable free mode for a script"),

  new SlashCommandBuilder()
    .setName("resethwid")
    .setDescription("Reset HWID for user")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clearcache")
    .setDescription("Clear script cache (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("checkconnection")
    .setDescription("Check connection between bot and web dashboard (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ✅ NEW: /setwebhook
  new SlashCommandBuilder()
    .setName("setwebhook")
    .setDescription("Set webhook untuk notifikasi saat script dijalankan")
    .addStringOption(o =>
      o.setName("url")
        .setDescription("Discord Webhook URL")
        .setRequired(true)
    ),
].map(c => c.toJSON());

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  try {
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: commands });
    console.log(`👑 Bot ready: ${client.user.tag}`);
    console.log(`🔗 API_BASE: ${CONFIG.apiBase}`);
    await updateGuildsList();
    setInterval(updateGuildsList, 60 * 1000);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

client.on("guildCreate", async (guild) => {
  console.log(`✅ Joined guild: ${guild.name} (${guild.id})`);
  await updateGuildsList();
});

client.on("guildDelete", async (guild) => {
  console.log(`❌ Left guild: ${guild.name} (${guild.id})`);
  await updateGuildsList();
});

async function sendPanelEmbed(channel, title, description, scriptId, scriptName, ownerId, guildId) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xFFD700)
    .setFooter({ text: `Kingmor 👑 • ${scriptName}` })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("redeem_key").setLabel("Redeem Key").setEmoji("🔑").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`get_script:${ownerId}:${scriptId}`).setLabel("Get Script").setEmoji("👑").setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`get_role:${scriptId}`).setLabel("Get Role").setEmoji("👤").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reset_hwid:${scriptId}`).setLabel("Reset HWID").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`get_stats:${scriptId}`).setLabel("Get Stats").setEmoji("📊").setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row1, row2, row3] });

  const cfg = readConfig();
  if (!cfg[guildId]) cfg[guildId] = {};
  cfg[guildId].panelChannelId = channel.id;
  cfg[guildId].panelScriptId = scriptId;
  writeConfig(cfg);
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton() && isBlacklisted(interaction.user.id)) {
      return interaction.reply({ content: "❌ You Have Been Blacklisted By The Owner", ephemeral: true }).catch(() => {});
    }

    // ==================== BUTTONS ====================
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith("get_script:")) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const parts = customId.split(":");
          const ownerId = parts[1];
          const scriptId = parts[2];

          let isFreeMode = false;
          try {
            const freeModeRes = await axios.get(`${CONFIG.apiBase}/api/freemode/${interaction.guildId}/${scriptId}`, {
              headers: internalHeaders, timeout: 8000
            });
            isFreeMode = freeModeRes.data.freeMode === true;
          } catch (err) {
            console.error(`❌ freemode check gagal: ${describeAxiosError(err)}`);
            const cfg = readConfig()[interaction.guildId] || {};
            isFreeMode = cfg.freeMode && cfg.freeMode[scriptId] === true;
          }

          if (isFreeMode) {
            const loaderCode = `loadstring(game:HttpGet("${CONFIG.apiBase}/api/loader/${scriptId}.lua"))()`;
            return interaction.editReply({ content: `\`\`\`lua\n${loaderCode}\n\`\`\`` }).catch(() => {});
          }

          const keys = readKeys();
          const validKey = keys.find(k => String(k.userId) === String(interaction.user.id) && k.scriptId === scriptId);

          if (!validKey) {
            return interaction.editReply({ content: "❌ You don't have a key for this script!" }).catch(() => {});
          }

          if (validKey.expiry && new Date(validKey.expiry) < new Date()) {
            return interaction.editReply({ content: "❌ Your key has expired!" }).catch(() => {});
          }

          const loaderCode = `script_key = "${validKey.key}"\nloadstring(game:HttpGet("${CONFIG.apiBase}/api/loader/${validKey.scriptId}.lua?key="..script_key))()`;
          return interaction.editReply({ content: `\`\`\`lua\n${loaderCode}\n\`\`\`` }).catch(() => {});
        } catch (err) {
          console.error("Get script error:", err);
          return interaction.editReply({ content: "❌ Failed to get script. Please try again." }).catch(() => {});
        }
      }

      if (customId === "redeem_key") {
        try {
          const modal = new ModalBuilder().setCustomId("modal_redeem").setTitle("Redeem Key");
          const keyInput = new TextInputBuilder()
            .setCustomId("input_key").setLabel("Key")
            .setPlaceholder("Enter your key here...").setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
          return interaction.showModal(modal).catch(() => {});
        } catch {
          return interaction.reply({ content: "❌ Failed to open modal.", ephemeral: true }).catch(() => {});
        }
      }

      if (customId.startsWith("get_role:") || customId === "get_role") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          const cfg = readConfig()[interaction.guildId] || {};
          const buyerRoleId = scriptId && cfg.buyerRoles && cfg.buyerRoles[scriptId]
            ? cfg.buyerRoles[scriptId] : cfg.buyerRole;

          if (!buyerRoleId) return interaction.editReply({ content: "❌ Buyer role has not been set for this script!" }).catch(() => {});

          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(interaction.user.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ You don't have a key!" }).catch(() => {});

          if (scriptId) {
            const validKey = userKeys.find(k => k.scriptId === scriptId);
            if (!validKey) return interaction.editReply({ content: "❌ You don't have a key for this script!" }).catch(() => {});
          }

          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (member.roles.cache.has(buyerRoleId)) return interaction.editReply({ content: "✅ You already have the buyer role!" }).catch(() => {});
          await member.roles.add(buyerRoleId);
          return interaction.editReply({ content: "✅ Buyer role has been assigned!" }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to assign role." }).catch(() => {});
        }
      }

      if (customId.startsWith("reset_hwid:") || customId === "reset_hwid") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(interaction.user.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ You don't have any active key!" }).catch(() => {});

          if (scriptId) {
            const validKey = userKeys.find(k => k.scriptId === scriptId);
            if (!validKey) return interaction.editReply({ content: "❌ You don't have a key for this script!" }).catch(() => {});
          }

          let resetCount = 0;
          const updatedKeys = keys.map(k => {
            if (String(k.userId) === String(interaction.user.id) && (scriptId ? k.scriptId === scriptId : true) && k.hwid) {
              resetCount++;
              return { ...k, hwid: null };
            }
            return k;
          });

          if (resetCount === 0) return interaction.editReply({ content: "ℹ️ No HWID is registered for your key." }).catch(() => {});
          writeKeys(updatedKeys);
          return interaction.editReply({ content: "✅ HWID has been reset!" }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (customId.startsWith("get_stats:") || customId === "get_stats") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(interaction.user.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ You don't have any active key!" }).catch(() => {});

          const relevantKeys = scriptId ? userKeys.filter(k => k.scriptId === scriptId) : userKeys;
          let stats = `📊 **YOUR KEY STATUS**\n\n`;
          relevantKeys.forEach(k => {
            const isExpired = k.expiry && new Date(k.expiry) < new Date();
            stats += `• Status: ${isExpired ? "❌ Expired" : "✅ Active"}\n`;
            stats += `• HWID: ${k.hwid ? "🔒 Bound" : "🔓 Not bound"}\n`;
            stats += `• Expiry: ${k.expiry ? new Date(k.expiry).toLocaleDateString() : "♾️ Lifetime"}\n`;
            stats += `• Key: \`${k.key}\`\n\n`;
          });
          if (stats.length > 2000) stats = stats.slice(0, 1990) + "\n...";
          return interaction.editReply({ content: stats }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to get stats." }).catch(() => {});
        }
      }
    }

    // ==================== MODAL ====================
    if (interaction.isModalSubmit() && interaction.customId === "modal_redeem") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      try {
        const keyInput = interaction.fields.getTextInputValue("input_key").toLowerCase().trim();
        const keys = readKeys();
        const keyData = keys.find(k => k.key === keyInput);

        if (!keyData) return interaction.editReply({ content: "❌ Invalid key." }).catch(() => {});
        if (keyData.userId && String(keyData.userId) !== String(interaction.user.id)) {
          return interaction.editReply({ content: "❌ This key is already used by another user." }).catch(() => {});
        }

        keyData.userId = String(interaction.user.id);
        keyData.username = interaction.user.username;
        keyData.redeemedAt = new Date().toISOString();
        writeKeys(keys);

        const cfg = readConfig()[interaction.guildId] || {};
        const buyerRoleId = cfg.buyerRoles && cfg.buyerRoles[keyData.scriptId]
          ? cfg.buyerRoles[keyData.scriptId] : cfg.buyerRole;

        if (buyerRoleId) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(buyerRoleId);
          } catch {}
        }

        return interaction.editReply({ content: "✅ Key redeemed successfully!" }).catch(() => {});
      } catch {
        return interaction.editReply({ content: "❌ Failed to redeem key." }).catch(() => {});
      }
    }

    // ==================== SELECT MENUS ====================
    if (interaction.isStringSelectMenu()) {

      if (interaction.customId === "deletescript_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          await axios.delete(`${CONFIG.apiBase}/api/scripts/internal/${scriptId}`, {
            headers: { ...internalHeaders, "x-owner-id": interaction.user.id }, timeout: 8000
          });
          const keys = readKeys();
          writeKeys(keys.filter(k => k.scriptId !== scriptId));
          clearCache(interaction.user.id);
          return interaction.editReply({ content: "✅ Script and all its keys have been permanently deleted!" }).catch(() => {});
        } catch (err) {
          console.error(`❌ deletescript gagal: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to delete script." }).catch(() => {});
        }
      }

      if (interaction.customId === "freemode_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = freeModeTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired. Please run /freemode again." }).catch(() => {});

          const { mode } = tempData;
          freeModeTempData.delete(interaction.user.id);

          const cfg = readConfig();
          if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
          if (!cfg[interaction.guildId].freeMode) cfg[interaction.guildId].freeMode = {};

          const enabled = mode === "enable";
          if (enabled) cfg[interaction.guildId].freeMode[scriptId] = true;
          else delete cfg[interaction.guildId].freeMode[scriptId];
          writeConfig(cfg);

          try {
            await axios.post(`${CONFIG.apiBase}/api/freemode/update`,
              { guildId: interaction.guildId, scriptId, enabled },
              { headers: internalHeaders, timeout: 8000 }
            );
          } catch (err) {
            console.error(`❌ freemode/update gagal: ${describeAxiosError(err)}`);
          }

          return interaction.editReply({
            content: `✅ Free mode has been **${enabled ? "ENABLED" : "DISABLED"}**!`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to update free mode." }).catch(() => {});
        }
      }

      if (interaction.customId === "freemode_mode_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const mode = interaction.values[0];
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          freeModeTempData.set(interaction.user.id, { mode });
          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("freemode_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to ${mode} free mode:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to load scripts." }).catch(() => {});
        }
      }

      if (interaction.customId === "setuppanel_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = panelTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired." }).catch(() => {});
          const { title, description } = tempData;
          panelTempData.delete(interaction.user.id);

          const myScripts = await getScriptsByOwner(interaction.user.id);
          const selectedScript = myScripts.find(s => s.id === scriptId);
          if (!selectedScript) return interaction.editReply({ content: "❌ Script not found or not yours!" }).catch(() => {});

          await sendPanelEmbed(interaction.channel, title, description, scriptId, selectedScript.name, interaction.user.id, interaction.guildId);
          return interaction.editReply({ content: `✅ Panel created with script: **${selectedScript.name}**!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to create panel." }).catch(() => {});
        }
      }

      if (interaction.customId === "setbuyerrole_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = buyerRoleTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired." }).catch(() => {});
          const { roleId } = tempData;
          buyerRoleTempData.delete(interaction.user.id);

          const cfg = readConfig();
          if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
          if (!cfg[interaction.guildId].buyerRoles) cfg[interaction.guildId].buyerRoles = {};
          cfg[interaction.guildId].buyerRoles[scriptId] = roleId;
          writeConfig(cfg);

          return interaction.editReply({ content: `✅ Buyer role <@&${roleId}> has been set!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to set buyer role." }).catch(() => {});
        }
      }

      // ✅ NEW: setwebhook select (jika user punya >1 script)
      if (interaction.customId === "setwebhook_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = webhookTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired. Run /setwebhook again." }).catch(() => {});
          webhookTempData.delete(interaction.user.id);

          const myScripts = await getScriptsByOwner(interaction.user.id);
          const selectedScript = myScripts.find(s => s.id === scriptId);
          if (!selectedScript) return interaction.editReply({ content: "❌ Script not found or not yours." }).catch(() => {});

          await axios.post(`${CONFIG.apiBase}/api/webhook/set`,
            { scriptId, url: tempData.url },
            { headers: internalHeaders, timeout: 8000 }
          );

          return interaction.editReply({
            content: `✅ Webhook berhasil diset untuk script **${selectedScript.name}**!\nSetiap kali script dijalankan, kamu akan dapat notifikasi di channel webhook tersebut.`
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ setwebhook_select gagal: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set webhook." }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith("whitelist_select:")) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const parts = interaction.customId.split(":");
          const targetType = parts[1];
          const targetId = parts[2];
          const days = parseInt(parts[3]);
          const adminId = parts[4];
          const scriptId = interaction.values[0];

          const myScripts = await getScriptsByOwner(adminId);
          const owned = myScripts.find(s => s.id === scriptId);
          if (!owned) return interaction.editReply({ content: "❌ This script is not yours." }).catch(() => {});

          const keys = readKeys();
          const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
          const cfg = readConfig()[interaction.guildId] || {};
          const buyerRoleId = cfg.buyerRoles && cfg.buyerRoles[scriptId] ? cfg.buyerRoles[scriptId] : cfg.buyerRole;

          if (targetType === "user") {
            const key = generateKey();
            keys.push({
              key, hwid: null, userId: String(targetId), username: null, scriptId,
              redeemedAt: new Date().toISOString(), expiry,
              createdAt: new Date().toISOString(), createdBy: adminId
            });
            writeKeys(keys);

            if (buyerRoleId) {
              try {
                const member = await interaction.guild.members.fetch(targetId);
                await member.roles.add(buyerRoleId);
              } catch {}
            }

            // ✅ FIX: tidak ada loader page URL — hanya pesan whitelist
            return interaction.editReply({
              content: `✅ <@${targetId}> telah berhasil di-whitelist untuk script **${owned.name}**!\nSilakan tekan tombol **Get Script** di panel untuk mendapatkan loader.`
            }).catch(() => {});
          }

          if (targetType === "role") {
            const role = await interaction.guild.roles.fetch(targetId);
            await interaction.guild.members.fetch();
            const members = role.members.filter(m => !m.user.bot);

            let addedCount = 0;
            for (const [, member] of members) {
              const userKey = generateKey();
              keys.push({
                key: userKey, hwid: null, userId: String(member.id), username: member.user.username,
                scriptId, redeemedAt: new Date().toISOString(), expiry,
                createdAt: new Date().toISOString(), createdBy: adminId
              });
              addedCount++;
              if (buyerRoleId) {
                try { await member.roles.add(buyerRoleId); } catch {}
              }
            }
            writeKeys(keys);

            // ✅ FIX: tidak ada loader page URL
            return interaction.editReply({
              content: `✅ <@&${targetId}> telah berhasil di-whitelist untuk script **${owned.name}**! (${addedCount} members)\nSilakan tekan tombol **Get Script** di panel untuk mendapatkan loader.`
            }).catch(() => {});
          }
        } catch {
          return interaction.editReply({ content: "❌ Failed to whitelist." }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith("genkey_select:")) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const parts = interaction.customId.split(":");
          const days = parseInt(parts[1]);
          const amount = parseInt(parts[2]);
          const adminId = parts[3];
          const scriptId = interaction.values[0];

          const myScripts = await getScriptsByOwner(adminId);
          const owned = myScripts.find(s => s.id === scriptId);
          if (!owned) return interaction.editReply({ content: "❌ This script is not yours." }).catch(() => {});

          const keys = readKeys();
          const generated = [];
          const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();

          for (let i = 0; i < amount; i++) {
            const key = generateKey();
            keys.push({
              key, hwid: null, userId: null, username: null, scriptId,
              redeemedAt: null, expiry,
              createdAt: new Date().toISOString(), createdBy: adminId
            });
            generated.push(key);
          }
          writeKeys(keys);

          const keyList = generated.map(k => `\`${k}\``).join("\n");
          return interaction.editReply({
            content: `✅ **${amount} key(s)** generated for script **${owned.name}**!\n\n${keyList}`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to generate keys." }).catch(() => {});
        }
      }
    }

    // ==================== SLASH COMMANDS ====================
    if (interaction.isChatInputCommand()) {
      const commandName = interaction.commandName;

      if (commandName === "clearcache") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        clearCache();
        return interaction.reply({ content: "✅ Cache cleared successfully!", ephemeral: true }).catch(() => {});
      }

      if (commandName === "checkconnection") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const start = Date.now();
          await axios.get(`${CONFIG.apiBase}/health`, { timeout: 8000 });
          const ms = Date.now() - start;

          let secretStatus = "❓ Belum dicek";
          try {
            await axios.get(`${CONFIG.apiBase}/api/scripts/internal`, {
              headers: internalHeaders, params: { ownerId: interaction.user.id }, timeout: 8000
            });
            secretStatus = "✅ API_SECRET cocok";
          } catch (err) {
            secretStatus = err.response?.status === 403
              ? "❌ API_SECRET TIDAK COCOK antara bot dan web"
              : `❌ Gagal cek: ${describeAxiosError(err)}`;
          }

          return interaction.editReply({
            content: `🔗 **Connection Check**\n\n• API_BASE: \`${CONFIG.apiBase}\`\n• Health check: ✅ OK (${ms}ms)\n• Secret check: ${secretStatus}`
          }).catch(() => {});
        } catch (err) {
          return interaction.editReply({
            content: `🔗 **Connection Check**\n\n• API_BASE: \`${CONFIG.apiBase}\`\n• Health check: ❌ GAGAL — ${describeAxiosError(err)}`
          }).catch(() => {});
        }
      }

      if (commandName === "whitelistrole") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        const role = interaction.options.getRole("role");
        const cfg = readConfig();
        if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
        cfg[interaction.guildId].whitelistRole = role.id;
        writeConfig(cfg);
        return interaction.reply({ content: `✅ Role <@&${role.id}> is now the bot admin role.`, ephemeral: true }).catch(() => {});
      }

      if (commandName === "setbuyerrole") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const role = interaction.options.getRole("role");
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            const cfg = readConfig();
            if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
            if (!cfg[interaction.guildId].buyerRoles) cfg[interaction.guildId].buyerRoles = {};
            cfg[interaction.guildId].buyerRoles[myScripts[0].id] = role.id;
            writeConfig(cfg);
            return interaction.editReply({ content: `✅ Buyer role <@&${role.id}> has been set for **${myScripts[0].name}**!` }).catch(() => {});
          }

          buyerRoleTempData.set(interaction.user.id, { roleId: role.id });
          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setbuyerrole_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to assign buyer role <@&${role.id}>:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to set buyer role." }).catch(() => {});
        }
      }

      if (commandName === "setuppanel") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const title = interaction.options.getString("title");
          const description = interaction.options.getString("description");
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            await sendPanelEmbed(interaction.channel, title, description, myScripts[0].id, myScripts[0].name, interaction.user.id, interaction.guildId);
            return interaction.editReply({ content: `✅ Panel created with script: **${myScripts[0].name}**!` }).catch(() => {});
          }

          panelTempData.set(interaction.user.id, { title, description });
          setTimeout(() => panelTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setuppanel_select").setPlaceholder("Select a script for this panel...").addOptions(options);

          return interaction.editReply({
            content: "Select which script you want to use for this panel:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to create panel." }).catch(() => {});
        }
      }

      if (commandName === "deletescript") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("deletescript_select").setPlaceholder("Select a script to delete...").addOptions(options);

          return interaction.editReply({
            content: "Select the script to delete permanently:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to load scripts." }).catch(() => {});
        }
      }

      if (commandName === "freemode") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const options = [
            new StringSelectMenuOptionBuilder()
              .setLabel("Enable Free Mode").setDescription("Allow all users to use the script without key")
              .setValue("enable").setEmoji("✅"),
            new StringSelectMenuOptionBuilder()
              .setLabel("Disable Free Mode").setDescription("Require key to use the script")
              .setValue("disable").setEmoji("❌"),
          ];
          const select = new StringSelectMenuBuilder()
            .setCustomId("freemode_mode_select").setPlaceholder("Select mode...").addOptions(options);

          return interaction.editReply({
            content: "Select whether to enable or disable free mode:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to open freemode menu." }).catch(() => {});
        }
      }

      // ✅ NEW: /setwebhook
      if (commandName === "setwebhook") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const url = interaction.options.getString("url");

          // Validasi format Discord webhook URL
          if (!url.startsWith("https://discord.com/api/webhooks/") && !url.startsWith("https://discordapp.com/api/webhooks/")) {
            return interaction.editReply({
              content: "❌ URL tidak valid! Harus berupa Discord webhook URL.\nContoh: `https://discord.com/api/webhooks/123456/token...`"
            }).catch(() => {});
          }

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ Kamu belum punya script." }).catch(() => {});

          if (myScripts.length === 1) {
            await axios.post(`${CONFIG.apiBase}/api/webhook/set`,
              { scriptId: myScripts[0].id, url },
              { headers: internalHeaders, timeout: 8000 }
            );
            return interaction.editReply({
              content: `✅ Webhook berhasil diset untuk script **${myScripts[0].name}**!\nSetiap kali script dijalankan, notifikasi akan dikirim ke webhook tersebut.`
            }).catch(() => {});
          }

          // Lebih dari 1 script — tampilkan select menu
          webhookTempData.set(interaction.user.id, { url });
          setTimeout(() => webhookTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setwebhook_select").setPlaceholder("Pilih script...").addOptions(options);

          return interaction.editReply({
            content: "Pilih script yang ingin kamu set webhook-nya:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ setwebhook gagal: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set webhook." }).catch(() => {});
        }
      }

      if (commandName === "whitelist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const targetRole = interaction.options.getRole("role");
          const days = interaction.options.getInteger("days");

          if (!targetUser && !targetRole) return interaction.editReply({ content: "❌ Select a user or role!" }).catch(() => {});

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          const targetType = targetUser ? "user" : "role";
          const targetId = targetUser ? targetUser.id : targetRole.id;

          if (myScripts.length === 1) {
            const scriptId = myScripts[0].id;
            const keys = readKeys();
            const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
            const cfg = readConfig()[interaction.guildId] || {};
            const buyerRoleId = cfg.buyerRoles && cfg.buyerRoles[scriptId] ? cfg.buyerRoles[scriptId] : cfg.buyerRole;

            if (targetUser) {
              const key = generateKey();
              keys.push({
                key, hwid: null, userId: String(targetUser.id), username: targetUser.username, scriptId,
                redeemedAt: new Date().toISOString(), expiry,
                createdAt: new Date().toISOString(), createdBy: interaction.user.id
              });
              writeKeys(keys);

              if (buyerRoleId) {
                try {
                  const member = await interaction.guild.members.fetch(targetUser.id);
                  await member.roles.add(buyerRoleId);
                } catch {}
              }

              // ✅ FIX: tidak ada loader page URL
              return interaction.editReply({
                content: `✅ <@${targetUser.id}> telah berhasil di-whitelist untuk script **${myScripts[0].name}**!\nSilakan tekan tombol **Get Script** di panel untuk mendapatkan loader.`
              }).catch(() => {});
            }

            if (targetRole) {
              const role = await interaction.guild.roles.fetch(targetRole.id);
              await interaction.guild.members.fetch();
              const members = role.members.filter(m => !m.user.bot);
              let addedCount = 0;
              for (const [, member] of members) {
                const userKey = generateKey();
                keys.push({
                  key: userKey, hwid: null, userId: String(member.id), username: member.user.username,
                  scriptId, redeemedAt: new Date().toISOString(), expiry,
                  createdAt: new Date().toISOString(), createdBy: interaction.user.id
                });
                addedCount++;
                if (buyerRoleId) {
                  try { await member.roles.add(buyerRoleId); } catch {}
                }
              }
              writeKeys(keys);

              // ✅ FIX: tidak ada loader page URL
              return interaction.editReply({
                content: `✅ <@&${targetRole.id}> telah berhasil di-whitelist untuk script **${myScripts[0].name}**! (${addedCount} members)\nSilakan tekan tombol **Get Script** di panel untuk mendapatkan loader.`
              }).catch(() => {});
            }
          }

          await interaction.editReply({ content: "_ _" }).catch(() => {});
          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId(`whitelist_select:${targetType}:${targetId}:${days}:${interaction.user.id}`)
            .setPlaceholder("Select a script...").addOptions(options);

          return interaction.followUp({
            content: "Select a script to whitelist:",
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to whitelist." }).catch(() => {});
        }
      }

      if (commandName === "blacklist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const reason = interaction.options.getString("reason") || "No reason";
          const bl = readBlacklist();
          if (bl.some(b => String(b.userId) === String(targetUser.id))) {
            return interaction.editReply({ content: "❌ This user is already blacklisted!" }).catch(() => {});
          }
          bl.push({
            userId: String(targetUser.id), username: targetUser.username, reason,
            blacklistedBy: interaction.user.id, blacklistedAt: new Date().toISOString()
          });
          writeBlacklist(bl);
          writeKeys(readKeys().filter(k => String(k.userId) !== String(targetUser.id)));
          return interaction.editReply({
            content: `🚫 **<@${targetUser.id}> has been Blacklisted!**\nAll script access has been revoked.`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to blacklist user." }).catch(() => {});
        }
      }

      if (commandName === "unblacklist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const bl = readBlacklist();
          const index = bl.findIndex(b => String(b.userId) === String(targetUser.id));
          if (index === -1) return interaction.editReply({ content: "❌ User is not blacklisted." }).catch(() => {});
          bl.splice(index, 1);
          writeBlacklist(bl);
          return interaction.editReply({ content: `✅ **<@${targetUser.id}> has been Unblacklisted!**` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to unblacklist user." }).catch(() => {});
        }
      }

      if (commandName === "genkey") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const days = interaction.options.getInteger("days");
          const amount = interaction.options.getInteger("amount") || 1;
          if (amount > 50) return interaction.editReply({ content: "❌ Maximum 50 keys per generation." }).catch(() => {});

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            const scriptId = myScripts[0].id;
            const keys = readKeys();
            const generated = [];
            const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
            for (let i = 0; i < amount; i++) {
              const key = generateKey();
              keys.push({ key, hwid: null, userId: null, username: null, scriptId, redeemedAt: null, expiry, createdAt: new Date().toISOString(), createdBy: interaction.user.id });
              generated.push(key);
            }
            writeKeys(keys);
            return interaction.editReply({
              content: `✅ **${amount} key(s)** generated for **${myScripts[0].name}**!\n\n${generated.map(k => `\`${k}\``).join("\n")}`
            }).catch(() => {});
          }

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId(`genkey_select:${days}:${amount}:${interaction.user.id}`)
            .setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to generate ${amount} key(s):`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to generate keys." }).catch(() => {});
        }
      }

      if (commandName === "revoke") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const key = interaction.options.getString("key");
          const targetUser = interaction.options.getUser("user");
          if (!key && !targetUser) return interaction.editReply({ content: "❌ Provide a key or user to revoke!" }).catch(() => {});

          const keys = readKeys();
          let removed = 0;

          if (key) {
            const newKeys = keys.filter(k => k.key !== key.toLowerCase().trim());
            removed = keys.length - newKeys.length;
            if (removed === 0) return interaction.editReply({ content: "❌ Key not found." }).catch(() => {});
            writeKeys(newKeys);
          } else {
            const newKeys = keys.filter(k => String(k.userId) !== String(targetUser.id));
            removed = keys.length - newKeys.length;
            writeKeys(newKeys);
          }

          return interaction.editReply({ content: `✅ Successfully revoked ${removed} key(s)!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to revoke." }).catch(() => {});
        }
      }

      if (commandName === "resethwid") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(targetUser.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ User doesn't have any key!" }).catch(() => {});

          let resetCount = 0;
          const updatedKeys = keys.map(k => {
            if (String(k.userId) === String(targetUser.id) && k.hwid) {
              resetCount++;
              return { ...k, hwid: null };
            }
            return k;
          });

          if (resetCount === 0) return interaction.editReply({ content: "ℹ️ No HWID is registered for this user." }).catch(() => {});
          writeKeys(updatedKeys);
          return interaction.editReply({ content: `✅ HWID has been reset for <@${targetUser.id}>! (${resetCount} key(s))` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (commandName === "listkeys") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const keys = readKeys();
          const myScripts = await getScriptsByOwner(interaction.user.id);
          const scriptMap = {};
          myScripts.forEach(s => { scriptMap[s.id] = s.name; });

          const myKeys = keys.filter(k => k.createdBy === interaction.user.id);
          if (myKeys.length === 0) return interaction.editReply({ content: "📭 You haven't generated any keys yet." }).catch(() => {});

          let list = "🔑 **YOUR GENERATED KEYS**\n\n";
          let used = 0, unused = 0;

          myKeys.sort((a, b) => (scriptMap[a.scriptId] || "").localeCompare(scriptMap[b.scriptId] || ""))
            .slice(0, 25).forEach(k => {
              const scriptName = scriptMap[k.scriptId] || "❓ Script deleted";
              if (k.userId) used++; else unused++;
              list += `**${scriptName}**\n`;
              list += `  • Key: \`${k.key}\`\n`;
              list += `  • Status: ${k.userId ? `✅ Used by <@${k.userId}>` : "⏳ Unused"}\n`;
              list += `  • HWID: ${k.hwid ? "🔒 Bound" : "🔓 Free"}\n`;
              list += `  • Expiry: ${k.expiry ? new Date(k.expiry).toLocaleDateString() : "♾️ Lifetime"}\n\n`;
            });

          list += `📊 **Total**: ${myKeys.length} | Used: ${used} | Unused: ${unused}`;
          if (list.length > 2000) list = list.slice(0, 1990) + "\n... (truncated)";

          return interaction.editReply({ content: list }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to list keys." }).catch(() => {});
        }
      }

      if (commandName === "userinfo") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No Permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const member = await interaction.guild.members.fetch(targetUser.id);
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(targetUser.id));
          const cfg = readConfig()[interaction.guildId] || {};
          const hasBuyerRole = member.roles.cache.some(r => {
            const buyerRoles = Object.values(cfg.buyerRoles || {});
            return buyerRoles.includes(r.id) || r.id === cfg.buyerRole;
          });

          const embed = new EmbedBuilder()
            .setTitle(`👤 User Info: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setColor(0xFFD700)
            .addFields(
              { name: "📛 User", value: `<@${targetUser.id}>`, inline: true },
              { name: "🆔 ID", value: targetUser.id, inline: true },
              { name: "🚫 Blacklist", value: isBlacklisted(targetUser.id) ? "❌ Yes" : "✅ No", inline: true },
              { name: "👑 Buyer Role", value: hasBuyerRole ? "✅ Has" : "❌ Doesn't have", inline: true },
              { name: "🔑 Key Count", value: String(userKeys.length), inline: true },
              { name: "🖥️ HWID", value: userKeys.some(k => k.hwid) ? "🔒 Bound" : "🔓 Not bound", inline: true }
            )
            .setFooter({ text: "Kingmor 👑" })
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to get user info." }).catch(() => {});
        }
      }
    }

  } catch (err) {
    console.error("❌ Unhandled interaction error:", err);
    try {
      if (interaction.deferred) await interaction.editReply({ content: "❌ An error occurred. Please try again later." });
      else if (!interaction.replied) await interaction.reply({ content: "❌ An error occurred. Please try again later.", ephemeral: true });
    } catch {}
  }
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled rejection:", error);
});

client.login(CONFIG.token);
