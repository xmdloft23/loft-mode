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

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;
    const sessionType = (req.query.type || 'short').toLowerCase();
    let responseSent = false;
    let sessionCleanedUp = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                if (fs.existsSync(path.join(sessionDir, id))) {
                    await removeFile(path.join(sessionDir, id));
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
                // FIXED: Using Ubuntu/Chrome browser for better pairing stability
                browser: ["Ubuntu", "Chrome", "20.0.04"], 
                syncFullHistory: false,
                markOnlineOnConnect: true,
            });

            if (!Gifted.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, ''); // Safisha namba (Clean number)

                // FIXED: Removed generateRandomCode() from requestPairingCode
                // Baileys automatically handles the internal link to WhatsApp servers.
                const code = await Gifted.requestPairingCode(num);
                
                if (!responseSent && !res.headersSent) {
                    res.json({ code: code, fallback: sessionType === 'short' && !isConfigured() });
                    responseSent = true;
                }
            }

            Gifted.ev.on('creds.update', saveCreds);
            Gifted.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await Gifted.groupAcceptInvite(GC_JID);
                    } catch (e) {
                        console.log("Group join error:", e.message);
                    }

                    await delay(10000); // Wait for creds.json to populate

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 10;

                    while (attempts < maxAttempts && !sessionData) {
                        const credsPath = path.join(sessionDir, id, "creds.json");
                        if (fs.existsSync(credsPath)) {
                            const data = fs.readFileSync(credsPath);
                            if (data.length > 200) {
                                sessionData = data;
                                break;
                            }
                        }
                        await delay(3000);
                        attempts++;
                    }

                    if (sessionData) {
                        let compressedData = zlib.gzipSync(sessionData);
                        let b64data = compressedData.toString('base64');
                        const fullSession = SESSION_PREFIX + b64data;

                        let msgText, msgButtons;
                        if (isConfigured() && sessionType === 'short') {
                            const shortId = await saveSession(fullSession);
                            const shortSession = `${SESSION_PREFIX}${shortId}`;
                            msgText = `*SESSION ID ✅*\n\n${shortSession}`;
                        } else {
                            msgText = `*SESSION ID ✅*\n\n${fullSession}`;
                        }

                        msgButtons = [
                            { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Session', copy_code: msgText.split('\n\n')[1] }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Bot Repo', url: BOT_REPO }) }
                        ];

                        await sendButtons(Gifted, Gifted.user.id, {
                            title: 'GIFTED TECH',
                            text: msgText,
                            footer: MSG_FOOTER,
                            buttons: msgButtons
                        });

                        await delay(2000);
                        await Gifted.ws.close();
                        await cleanUpSession();
                    }
                } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    GIFTED_PAIR_CODE();
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
