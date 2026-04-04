require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 50900,
    SESSION_PREFIX: process.env.SESSION_PREFIX || "Loft~",
    GC_JID: process.env.GC_JID || "120363402688564034@g.us",
    DATABASE_URL: process.env.DATABASE_URL || "MONGODB_URI=mongodb+srv://mickidadyhamza_db_user:U41ddz44QsMxBI7D@cluster0.motlmco.mongodb.net/?appName=Cluster0", // Your Db URL here(optional). Can either be mongodb or postreSQL
    BOT_REPO: process.env.BOT_REPO || "https://github.com/xmdloft23/loft-quantum",
    WA_CHANNEL: process.env.WA_CHANNEL || "https://whatsapp.com/channel/0029Vb6B9xFCxoAseuG1g610",
    MSG_FOOTER: process.env.MSG_FOOTER || "> *LOFT-BOT-MASTER🚀*",
};
