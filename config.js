require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 50900,
    SESSION_PREFIX: process.env.SESSION_PREFIX || "Loft~",
    GC_JID: process.env.GC_JID || "G3ChQEjwrdVBTBUQHWSNHF?mode=gi_t",
    DATABASE_URL: process.env.DATABASE_URL || "DATABASE_URL: process.env.DATABASE_URL || "", // Your Db URL here(optional). Can either be mongodb or postreSQL
    BOT_REPO: process.env.BOT_REPO || "https://github.com/xmdloft23/loft-quantum",
    WA_CHANNEL: process.env.WA_CHANNEL || "https://whatsapp.com/channel/0029Vb6B9xFCxoAseuG1g610",
    MSG_FOOTER: process.env.MSG_FOOTER || "> *LOFT-BOT-MASTER🚀*",
};
