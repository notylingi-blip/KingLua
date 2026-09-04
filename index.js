console.log("👑 Starting KingLua...");

// Jalankan server.js
require("./server.js");

// Jalankan bot.js setelah 2 detik
setTimeout(() => {
  console.log("🤖 Starting bot...");
  require("./bot.js");
}, 2000);
