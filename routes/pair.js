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
                await removeFile(path.join(sessionDir, id));
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    // Inner function: actual pairing + connection logic (clean & reusable)
    async function performPairingAndConnection() {
        const { version } = await fetchLatestBaileysVersion();
        console.log("Baileys version:", version);

        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));

        let Gifted = giftedConnect({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntuChrome(),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
            getMessage: async () => undefined,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        // Request pairing code (only if not already registered)
        if (!Gifted.authState.creds.registered) {
            await delay(1500);
            num = num.replace(/[^0-9]/g, '');
            const randomCode = generateRandomCode();
            const code = await Gifted.requestPairingCode(num, randomCode);

            if (!responseSent && !res.headersSent) {
                res.json({ 
                    code: code, 
                    fallback: sessionType === 'short' && !isConfigured() 
                });
                responseSent = true;
            }
        }

        // Save creds automatically
        Gifted.ev.on('creds.update', saveCreds);

        // Return a Promise so we can control success/failure cleanly
        return new Promise((resolve, reject) => {
            let sessionProcessed = false;

            Gifted.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        // Join group
                        try {
                            await Gifted.groupAcceptInvite(GC_JID);
                        } catch (e) {
                            console.log("Group join error:", e.message);
                        }

                        await delay(50000);

                        // Read session data with retries
                        let sessionData = null;
                        let attempts = 0;
                        const maxAttempts = 15;

                        while (attempts < maxAttempts && !sessionData) {
                            try {
                                const credsPath = path.join(sessionDir, id, "creds.json");
                                if (fs.existsSync(credsPath)) {
                                    const data = fs.readFileSync(credsPath);
                                    if (data && data.length > 100) {
                                        sessionData = data;
                                        break;
                                    }
                                }
                                await delay(8000);
                                attempts++;
                            } catch (readError) {
                                console.error("Read error:", readError);
                                await delay(2000);
                                attempts++;
                            }
                        }

                        if (!sessionData) {
                            await cleanUpSession();
                            reject(new Error("No session data generated"));
                            return;
                        }

                        // Compress & prepare session
                        let compressedData = zlib.gzipSync(sessionData);
                        let b64data = compressedData.toString('base64');
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

                        await delay(5000);

                        // Send buttons with retries
                        let sessionSent = false;
                        let sendAttempts = 0;
                        const maxSendAttempts = 5;

                        while (sendAttempts < maxSendAttempts && !sessionSent) {
                            try {
                                await sendButtons(Gifted, Gifted.user.id, {
                                    title: '',
                                    text: msgText,
                                    footer: MSG_FOOTER,
                                    buttons: msgButtons
                                });
                                sessionSent = true;
                            } catch (sendError) {
                                console.error("Send error:", sendError);
                                sendAttempts++;
                                if (sendAttempts < maxSendAttempts) await delay(3000);
                            }
                        }

                        await delay(3000);
                        await Gifted.ws.close();

                        sessionProcessed = true;
                        resolve(); // SUCCESS

                    } catch (sessionError) {
                        console.error("Session processing error:", sessionError);
                        reject(sessionError);
                    } finally {
                        await cleanUpSession();
                    }

                } else if (connection === "close" && lastDisconnect) {
                    const statusCode = lastDisconnect.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log("Connection closed unexpectedly - will retry");
                        if (!sessionProcessed) {
                            reject(new Error("Connection closed before session sent"));
                        }
                    } else {
                        reject(new Error("Logged out (401)"));
                    }
                }
            });

            // Extra safety: catch any socket errors
            Gifted.ev.on('error', (err) => {
                console.error("Socket error:", err);
                reject(err);
            });
        });
    }

    // Outer wrapper with limited retries (no recursion/stack overflow)
    async function connectWithRetries() {
        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            attempt++;
            try {
                console.log(`Pairing attempt \( {attempt}/ \){maxAttempts}`);
                return await performPairingAndConnection();
            } catch (err) {
                console.error(`Attempt ${attempt} failed:`, err.message);
                if (attempt < maxAttempts) {
                    await delay(5000);
                } else {
                    throw err;
                }
            }
        }
    }

    // Main execution
    try {
        await connectWithRetries();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service is Currently Unavailable" });
            responseSent = true;
        }
    }
});

module.exports = router;