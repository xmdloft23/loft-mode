const { 
    giftedId,
    removeFile,
    generateRandomCode
} = require('../gift');
const { SESSION_PREFIX, GC_JID, BOT_REPO, WA_CHANNEL, MSG_FOOTER } = require('../config');
const { isConfigured, saveSession } = require('../gift/sessionStore');
const zlib = require('zlib');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const { sendButtons } = require('gifted-btns');
const {
    default: giftedConnect,
    useMultiFileAuthState,
    delay,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "session");

// FIXED: Route changed to '/code' to match frontend fetch
router.get('/code', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;
    const sessionType = (req.query.type || 'short').toLowerCase();
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                const fullPath = path.join(sessionDir, id);
                if (fs.existsSync(fullPath)) {
                    await removeFile(fullPath);
                }
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function GIFTED_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));
        
        try {
            let Gifted = giftedConnect({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"], 
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });

            if (!Gifted.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, ''); // Safisha namba

                // FIXED: Removed randomCode. WhatsApp needs ONLY the number here.
                const code = await Gifted.requestPairingCode(num);
                
                if (!responseSent && !res.headersSent) {
                    res.json({ code: code, fallback: sessionType === 'short' && !isConfigured() });
                    responseSent = true;
                }
            }

            Gifted.ev.on('creds.update', saveCreds);
            Gifted.ev.on("connection.update", async (s) => {
                const { connection } = s;

                if (connection === "open") {
                    try { await Gifted.groupAcceptInvite(GC_JID); } catch (e) {}

                    await delay(10000); 
                    let sessionData = null;
                    const credsPath = path.join(sessionDir, id, "creds.json");

                    for (let i = 0; i < 10; i++) {
                        if (fs.existsSync(credsPath)) {
                            const data = fs.readFileSync(credsPath);
                            if (data.length > 200) {
                                sessionData = data;
                                break;
                            }
                        }
                        await delay(3000);
                    }

                    if (sessionData) {
                        let compressedData = zlib.gzipSync(sessionData);
                        let b64data = compressedData.toString('base64');
                        const fullSession = SESSION_PREFIX + b64data;
                        let msgText = `*SESSION ID ✅*\n\n${fullSession}`;

                        await Gifted.sendMessage(Gifted.user.id, { text: msgText });
                        
                        await delay(2000);
                        await Gifted.ws.close();
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error("Main error:", err);
            if (!responseSent) {
                res.status(500).json({ error: "Service Error" });
                responseSent = true;
            }
        }
    }

    await GIFTED_PAIR_CODE();
});

module.exports = router;
           
