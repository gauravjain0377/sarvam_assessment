"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const { WebSocketServer } = require("ws");

const { SarvamClient } = require("./lib/sarvamClient");
const { SessionStore } = require("./lib/sessionStore");
const { buildReplyMessages, buildClassifyMessages, parseClassification } = require("./lib/promptBuilder");

const PORT = Number(process.env.PORT) || 3000;

const sarvam = new SarvamClient({
  apiKey: process.env.SARVAM_API_KEY,
  model: process.env.SARVAM_MODEL || "sarvam-105b",
  ratePerMinute: Number(process.env.SARVAM_RATE_LIMIT_PER_MIN) || 35,
});

const sessions = new SessionStore();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mockMode: sarvam.mockMode, model: sarvam.model, queueDepth: sarvam.queueDepth });
});

app.get("/api/stats", (_req, res) => {
  res.json({ ...sessions.getStats(), queueDepth: sarvam.queueDepth, mockMode: sarvam.mockMode });
});

app.get("/api/sessions", (_req, res) => {
  res.json(sessions.listSessions());
});

const server = app.listen(PORT, () => {
  console.log(`Setu listening on http://localhost:${PORT}`);
  if (sarvam.mockMode) {
    console.log("  -> No SARVAM_API_KEY set: running in mock mode. See .env.example.");
  } else {
    console.log(`  -> Sarvam live mode: ${sarvam.model}`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT=3001 or stop the existing Setu server.`);
    process.exit(1);
  }
  throw err;
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return socket.send(JSON.stringify({ type: "error", error: "Malformed message." }));
    }

    if (payload.type !== "user_message") return;
    const { sessionId, message } = payload;
    if (!sessionId || typeof message !== "string" || !message.trim()) {
      return socket.send(JSON.stringify({ type: "error", error: "sessionId and message are required." }));
    }

    const history = sessions.getHistoryForModel(sessionId);
    const startedAt = Date.now();

    // These aren't cosmetic — they're the real state the request passes
    // through. The client renders them as they arrive, so the pipeline
    // panel is a live trace of this handler, not an animation faked to
    // look busy.
    const stage = (name, extra = {}) =>
      socket.send(JSON.stringify({ type: "stage", stage: name, ts: Date.now(), ...extra }));

    stage("received");

    try {
      if (sarvam.queueDepth > 0) {
        stage("queued", { depth: sarvam.queueDepth });
      }
      stage("generating");

      // Reply and classification run as two independent calls against the same
      // free model, both going through the shared rate-limited queue — this is
      // the "two-step" shape: user-facing conversation stays clean, while a
      // separate structured pass extracts intent/urgency/sentiment for the
      // dashboard, without polluting the chat with hidden JSON.
      const [reply, rawClassification] = await Promise.all([
        sarvam.complete(buildReplyMessages(history, message), { reasoningEffort: null }),
        sarvam.complete(buildClassifyMessages(message), {
          temperature: 0,
          maxTokens: 900,
          reasoningEffort: null,
          responseFormat: { type: "json_object" },
          allowReasoningFallback: true,
        }),
      ]);

      stage("classified");

      const classification = parseClassification(rawClassification);
      const latencyMs = Date.now() - startedAt;

      const session = sessions.recordTurn(sessionId, {
        userMessage: message,
        reply,
        classification,
        latencyMs,
      });

      stage(session.escalated ? "escalated" : "resolved");

      socket.send(
        JSON.stringify({
          type: "assistant_message",
          reply,
          classification,
          escalated: session.escalated,
          latencyMs,
          queueDepth: sarvam.queueDepth,
          mockMode: sarvam.mockMode,
        })
      );
    } catch (err) {
      console.error("Chat turn failed:", err.message);
      socket.send(
        JSON.stringify({
          type: "error",
          error: "Setu couldn't reach the language model just now. Please try again.",
        })
      );
    }
  });
});
