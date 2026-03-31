const { 
    giftedId,
    removeFile,
    generateRandomCode  // kept in case used elsewhere in your project
} = require('../gift');
const { SESSION_PREFIX, GC_JID, BOT_REPO, WA_CHANNEL, MSG_FOOTER } = require('../config');
const { isConfigured, saveSession } = require('../gift/sessionStore');
const zlib = require('zlib');
const express = require('express');
const fs = require('fs');
const path = require('path');
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
const router = express.Router();

router.get('/', async (req, res) => {
    let num = req.query.number;
    const sessionType = (req.query.type || 'short').toLowerCase();
    const id = giftedId();

    let responseSent = false;
    let sessionCleanedUp = false;

    const cleanUpSession = async () => {
        if (!sessionCleanedUp) {
            try {
                await removeFile(path.join(sessionDir, id));
            } catch (e) {
                console.error("Cleanup error:", e.message);
            }
            sessionCleanedUp = true;
        }
    };

    if (!num) {
        if (!responseSent && !res.headersSent) {
            res.status(400).json({ error: "Number is required (?number=2557xxxxxxxx)" });
            responseSent = true;
        }
        return;
    }

    // Clean number (international format, no + or symbols)
    num = num.replace(/[^0-9]/g, '');
    if (num.length < 10) {
        if (!responseSent && !res.headersSent) {
            res.status(400).json({ error: "Invalid number format" });
            responseSent = true;
        }
        return;
    }

    async function startPairing() {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));

        const Gifted = giftedConnect({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'), // More stable than hardcoded version
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
            getMessage: async () => undefined,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
        });

        Gifted.ev.on('creds.update', saveCreds);

        Gifted.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Request pairing code when socket is ready (more reliable)
            if (!Gifted.authState.creds.registered && (connection === "connecting" || !!qr)) {
                await delay(1500);
                try {
                    const code = await Gifted.requestPairingCode(num); // ← FIXED: only 1 argument
                    if (!responseSent && !res.headersSent) {
                        res.json({ 
                            code: code, 
                            fallback: sessionType === 'short' && !isConfigured() 
                        });
                        responseSent = true;
                    }
                } catch (pairErr) {
                    console.error("Pairing code error:", pairErr);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).json({ error: "Failed to generate pairing code" });
                        responseSent = true;
                    }
                    await cleanUpSession();
                }
            }

            if (connection === "open") {
                try {
                    await Gifted.groupAcceptInvite(GC_JID).catch(() => {});
                    await delay(5000);

                    // Wait for creds.json to be fully written
                    let sessionData = null;
                    let attempts = 0;
                    while (attempts < 15 && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                        } catch (e) {}
                        await delay(3000);
                        attempts++;
                    }

                    if (!sessionData) throw new Error("Session data not generated");

                    const compressedData = zlib.gzipSync(sessionData);
                    const b64data = compressedData.toString('base64');
                    const fullSession = SESSION_PREFIX + b64data;

                    let msgText, msgButtons;
                    if (isConfigured() && sessionType === 'short') {
                        const shortId = await saveSession(fullSession);
                        const shortSession = `\( {SESSION_PREFIX} \){shortId}`;
                        msgText = `*SESSION ID ✅*\n\n${shortSession}`;
                        msgButtons = [
                            { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Session', copy_code: shortSession }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Bot Repo', url: BOT_REPO }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Join WaChannel', url: WA_CHANNEL }) }
                        ];
                    } else {
                        msgText = `*SESSION ID ✅*\n\n${fullSession}`;
                        msgButtons = [
                            { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Session', copy_code: fullSession }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Bot Repo', url: BOT_REPO }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Join WaChannel', url: WA_CHANNEL }) }
                        ];
                    }

                    await sendButtons(Gifted, Gifted.user.id, {
                        title: '',
                        text: msgText,
                        footer: MSG_FOOTER,
                        buttons: msgButtons
                    });

                } catch (err) {
                    console.error("Session processing error:", err);
                } finally {
                    await delay(3000);
                    await Gifted.ws.close().catch(() => {});
                    await cleanUpSession();
                }
            } 
            else if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== 401) {
                    console.log("Reconnecting...");
                    await delay(5000);
                    // Restart pairing process instead of recursion
                    startPairing().catch(console.error);
                }
            }
        });

        // Start the connection
        await Gifted.connect();
    }

    try {
        await startPairing();
    } catch (err) {
        console.error("Fatal error:", err);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Service Error" });
        }
    }
});

module.exports = router;