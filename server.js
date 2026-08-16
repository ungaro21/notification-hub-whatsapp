import express from "express";
import pino from "pino";
import QRCode from "qrcode";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const SEND_TOKEN = "NH_SEND_2026_WAYNE_77099571";

let sock = null;
let connected = false;
let currentQR = null;

const logger = pino({ level: "silent" });

function cleanPhone(v) {
  return String(v || "").replace(/\D/g, "");
}

async function connectWhatsApp() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./auth_state");

  sock = makeWASocket({
    auth: state,
    logger,
    markOnlineOnConnect: false,
    browser: ["Chrome", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      console.log("New WhatsApp QR generated");
    }

    if (connection === "open") {
      connected = true;
      currentQR = null;
      console.log("WHATSAPP CONNECTED");
    }

    if (connection === "close") {
      connected = false;

      const status =
        lastDisconnect?.error?.output?.statusCode;

      if (status !== DisconnectReason.loggedOut) {
        console.log("Reconnecting...");
        setTimeout(connectWhatsApp, 3000);
      }
    }
  });
}

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>Notification Hub WhatsApp</title>
    <style>
      body{
        font-family:Arial;
        background:#111827;
        color:white;
        text-align:center;
        padding:40px
      }
      .box{
        max-width:500px;
        margin:auto;
        background:#1f2937;
        border-radius:20px;
        padding:30px
      }
      img{
        background:white;
        padding:15px;
        border-radius:15px;
        max-width:300px
      }
      .ok{color:#4ade80}
      .waiting{color:#fbbf24}
    </style>
  </head>

  <body>
    <div class="box">
      <h1>Notification Hub</h1>

      ${
        connected
        ? `
          <h2 class="ok">WhatsApp Connected ✓</h2>
          <p>Ready to send alerts.</p>
        `
        : currentQR
        ? `
          <h2 class="waiting">Scan WhatsApp QR</h2>
          <img src="${currentQR}">
          <p>WhatsApp → Linked Devices → Link a Device</p>
        `
        : `
          <h2 class="waiting">Starting WhatsApp...</h2>
        `
      }
    </div>
  </body>
  </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    connected
  });
});

app.post("/send", async (req, res) => {
  try {
    const token = req.headers["x-send-token"];

    if (token !== SEND_TOKEN) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    if (!connected || !sock) {
      return res.status(503).json({
        ok: false,
        error: "WhatsApp not connected"
      });
    }

    const phone = cleanPhone(req.body.phone);
    const message = String(req.body.message || "").trim();

    if (!phone || !message) {
      return res.status(400).json({
        ok: false,
        error: "phone and message required"
      });
    }

    const jid = `${phone}@s.whatsapp.net`;

    await sock.sendMessage(jid, {
      text: message
    });

    console.log("SENT TO", phone);

    res.json({
      ok: true,
      sent: true,
      phone
    });

  } catch (e) {
    console.log("SEND ERROR:", e.message);

    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
  connectWhatsApp();
});
