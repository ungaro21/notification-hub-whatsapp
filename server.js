import express from "express";
import axios from "axios";
import pino from "pino";
import QRCode from "qrcode";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();

const PORT = process.env.PORT || 10000;
const HUB_URL = "https://notifications.42web.io";

const BRIDGE_TOKEN =
  "fb4022636eaa4aa8a4155ada35cccb319821e1a8954d60ab472ae44ba1eef2";

let sock = null;
let connected = false;
let currentQR = null;
let working = false;

const logger = pino({ level: "silent" });

async function ack(id, status, error = "") {
  try {
    await axios.post(
      `${HUB_URL}/api/ack.php`,
      {
        id,
        status,
        error
      },
      {
        headers: {
          Authorization: `Bearer ${BRIDGE_TOKEN}`
        },
        timeout: 15000
      }
    );
  } catch (e) {
    console.log("ACK error:", e.message);
  }
}

async function processAlerts() {
  if (!connected || !sock || working) return;

  working = true;

  try {
    const response = await axios.get(
      `${HUB_URL}/api/pending.php`,
      {
        headers: {
          Authorization: `Bearer ${BRIDGE_TOKEN}`
        },
        timeout: 15000
      }
    );

    const alerts = response.data?.alerts || [];

    for (const alert of alerts) {
      const phone = String(alert.destination || "")
        .replace(/\D/g, "");

      if (!phone) {
        await ack(
          alert.id,
          "failed",
          "No destination number"
        );
        continue;
      }

      const jid = `${phone}@s.whatsapp.net`;

      let prefix = "🔔 ALERT";

      if (alert.priority === "high") {
        prefix = "⚠️ IMPORTANT";
      }

      if (alert.priority === "urgent") {
        prefix = "🚨 URGENT";
      }

      const text = `${prefix}

${alert.title}

${alert.message}

Source: ${alert.source}`;

      try {
        await sock.sendMessage(
          jid,
          { text }
        );

        await ack(
          alert.id,
          "sent"
        );

        console.log(
          "Sent alert",
          alert.id,
          "to",
          phone
        );

      } catch (e) {

        console.log(
          "Send failed:",
          e.message
        );

        await ack(
          alert.id,
          "failed",
          e.message
        );
      }

      await new Promise(
        resolve =>
          setTimeout(resolve, 1500)
      );
    }

  } catch (e) {

    console.log(
      "Queue error:",
      e.message
    );

  } finally {

    working = false;
  }
}

async function connectWhatsApp() {

  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    "./auth_state"
  );

  sock = makeWASocket({
    auth: state,
    logger,
    markOnlineOnConnect: false,
    browser: [
      "Notification Hub",
      "Chrome",
      "1.0"
    ]
  });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    async update => {

      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {

        currentQR =
          await QRCode.toDataURL(qr);

        console.log(
          "New WhatsApp QR generated"
        );
      }

      if (connection === "open") {

        connected = true;
        currentQR = null;

        console.log(
          "WHATSAPP CONNECTED"
        );

        processAlerts();
      }

      if (connection === "close") {

        connected = false;

        const status =
          lastDisconnect?.
          error?.
          output?.
          statusCode;

        if (
          status !==
          DisconnectReason.loggedOut
        ) {

          console.log(
            "Reconnecting..."
          );

          setTimeout(
            connectWhatsApp,
            3000
          );
        }
      }
    }
  );
}

app.get("/", (req, res) => {

  res.send(`
    <html>
    <head>
      <title>Notification Hub WhatsApp</title>
      <style>
        body {
          font-family: Arial;
          background:#111827;
          color:white;
          text-align:center;
          padding:40px;
        }

        .box {
          max-width:500px;
          margin:auto;
          background:#1f2937;
          border-radius:20px;
          padding:30px;
        }

        img {
          background:white;
          padding:15px;
          border-radius:15px;
          max-width:300px;
        }

        .ok {
          color:#4ade80;
        }

        .waiting {
          color:#fbbf24;
        }
      </style>
    </head>

    <body>
      <div class="box">

        <h1>Notification Hub</h1>

        ${
          connected
          ?
          `
          <h2 class="ok">
            WhatsApp Connected ✓
          </h2>

          <p>
            Alert bridge is running.
          </p>
          `
          :
          currentQR
          ?
          `
          <h2 class="waiting">
            Scan WhatsApp QR
          </h2>

          <img src="${currentQR}">

          <p>
            WhatsApp →
            Linked Devices →
            Link a Device
          </p>
          `
          :
          `
          <h2 class="waiting">
            Starting WhatsApp...
          </h2>

          <p>
            Refresh this page shortly.
          </p>
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
    whatsapp: connected
  });
});

app.get("/check", async (req, res) => {

  await processAlerts();

  res.json({
    ok: true,
    connected
  });
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server listening on port ${PORT}`
    );

    connectWhatsApp();

    setInterval(
      processAlerts,
      30000
    );
  }
);
