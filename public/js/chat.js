(() => {
  const thread = document.getElementById("thread");
  const composer = document.getElementById("composer");
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");
  const voiceLangSelect = document.getElementById("voiceLang");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const queueNote = document.getElementById("queueNote");
  const escalationBox = document.getElementById("escalationBox");
  const finalStageLabel = document.getElementById("finalStageLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const caseCard = document.getElementById("caseCard");
  const caseStatus = document.getElementById("caseStatus");
  const caseSummary = document.getElementById("caseSummary");
  const caseIssue = document.getElementById("caseIssue");
  const caseAction = document.getElementById("caseAction");
  const caseReference = document.getElementById("caseReference");
  const caseLocation = document.getElementById("caseLocation");
  const caseNext = document.getElementById("caseNext");
  const caseDecision = document.getElementById("caseDecision");

  const fields = {
    language: document.getElementById("fLanguage"),
    intent: document.getElementById("fIntent"),
    category: document.getElementById("fCategory"),
    urgency: document.getElementById("fUrgency"),
    sentiment: document.getElementById("fSentiment"),
    confidence: document.getElementById("fConfidence"),
  };

  const sessionId =
    sessionStorage.getItem("setu-session-id") ||
    (() => {
      const id = "sess-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("setu-session-id", id);
      return id;
    })();

  const LANG_NAMES = { hi: "Hindi", en: "English", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", unknown: "—" };

  // ---------- offline resilience ----------
  // Register the shell cache so the page still opens with no connection.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const offlineBanner = document.getElementById("offlineBanner");
  const offlineBannerText = document.getElementById("offlineBannerText");
  const offlineNote = document.getElementById("offlineNote");
  const simOfflineBtn = document.getElementById("simOfflineBtn");
  const QUEUE_KEY = "setu-offline-queue";
  let simulatedOffline = false;

  // A tiny, honest local fallback — no AI, just keyword matching — so a
  // fully offline user isn't staring at a dead screen. It's clearly labeled
  // as a canned local answer, and the real message still gets queued for
  // Setu's actual reply once connectivity returns.
  const LOCAL_FAQ = [
    { keywords: ["order", "delivery", "late", "deliver"], reply: "Most delivery delays resolve within 24 hours. Your message is queued — a full answer is on its way once you're back online." },
    { keywords: ["password", "login", "log in", "account", "locked"], reply: "For login issues, try 'Forgot password' on the sign-in screen. Your message is queued for a full answer once you're back online." },
    { keywords: ["refund", "charge", "payment", "paisa", "charged", "billing"], reply: "Refunds typically take 5–7 business days to reflect. Your message is queued for a full answer once you're back online." },
  ];
  function localFallbackReply(text) {
    const lower = text.toLowerCase();
    const hit = LOCAL_FAQ.find((f) => f.keywords.some((k) => lower.includes(k)));
    return hit ? hit.reply : "You're offline right now. Your message has been queued and Setu will answer as soon as you're back online.";
  }

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    renderOfflineNote(q);
  }
  function renderOfflineNote(q) {
    offlineNote.textContent = q.length > 0 ? `Offline queue: ${q.length} message(s) waiting to send` : "Offline queue: empty";
  }

  function isOffline() {
    return simulatedOffline || !navigator.onLine || !ws || ws.readyState !== WebSocket.OPEN;
  }

  function updateOfflineBanner() {
    const offline = isOffline();
    offlineBanner.classList.toggle("show", offline);
    offlineBannerText.textContent = simulatedOffline
      ? "Simulated offline mode is on. Messages are queued on this device and will send once you turn it off."
      : "You're offline. Messages are queued on this device and will send the moment you're back online.";
  }

  simOfflineBtn.addEventListener("click", () => {
    simulatedOffline = !simulatedOffline;
    simOfflineBtn.classList.toggle("on", simulatedOffline);
    simOfflineBtn.textContent = simulatedOffline ? "Back online (simulated)" : "Simulate offline";
    updateOfflineBanner();
    if (!simulatedOffline) flushQueue();
  });

  window.addEventListener("online", () => {
    updateOfflineBanner();
    if (!simulatedOffline) flushQueue();
  });
  window.addEventListener("offline", updateOfflineBanner);

  function flushQueue() {
    if (isOffline()) return;
    const q = loadQueue();
    if (q.length === 0) return;
    saveQueue([]);
    q.forEach((item) => {
      const bubble = document.querySelector(`.msg.queued[data-qid="${item.id}"]`);
      if (bubble) bubble.remove();
      sendMessage(item.text, { fromQueue: true });
    });
  }

  renderOfflineNote(loadQueue());

  // ---------- pipeline stepper ----------
  // Order matters: this is the real sequence stage events arrive in from the
  // server, driven by lib/rateLimiter.js and server.js — not a fixed timer.
  const STAGE_ORDER = ["received", "queued", "generating", "classified", "final"];
  const pipelineSteps = {};
  document.querySelectorAll(".step[data-stage]").forEach((el) => {
    pipelineSteps[el.dataset.stage] = el;
  });

  function resetPipeline() {
    Object.values(pipelineSteps).forEach((el) => {
      el.classList.remove("active", "done", "escalated");
      el.querySelector(".dot")?.classList.remove("pulsing");
    });
    finalStageLabel.textContent = "Routed";
  }

  function advancePipeline(stageName, meta = {}) {
    const targetKey = stageName === "escalated" || stageName === "resolved" ? "final" : stageName;
    const targetIndex = STAGE_ORDER.indexOf(targetKey);
    if (targetIndex === -1) return;

    STAGE_ORDER.forEach((key, i) => {
      const el = pipelineSteps[key];
      if (!el) return;
      const dot = el.querySelector(".dot");
      if (i < targetIndex) {
        el.classList.add("done");
        el.classList.remove("active");
        dot?.classList.remove("pulsing");
      } else if (i === targetIndex) {
        el.classList.add("active");
        el.classList.remove("done");
        // Final stage stops pulsing (it's a resting state); earlier stages pulse while active.
        if (key === "final") dot?.classList.remove("pulsing");
        else dot?.classList.add("pulsing");
      } else {
        el.classList.remove("active", "done");
        dot?.classList.remove("pulsing");
      }
    });

    if (targetKey === "queued" && meta.depth) {
      pipelineSteps.queued.querySelector("span:last-child").textContent = `Rate-limit queue (${meta.depth} waiting)`;
    } else if (pipelineSteps.queued) {
      pipelineSteps.queued.querySelector("span:last-child").textContent = "Rate-limit queue";
    }

    if (stageName === "escalated") {
      finalStageLabel.textContent = "Escalated";
      pipelineSteps.final.classList.add("escalated");
    } else if (stageName === "resolved") {
      finalStageLabel.textContent = "Resolved";
    }
  }

  function appendMessage(role, text) {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = text;
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function setStatus(connected, mock) {
    statusDot.classList.toggle("mock", !!mock);
    statusText.textContent = !connected ? "reconnecting…" : mock ? "connected · mock mode (no API key)" : "connected · live";
  }

  let ws;
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      setStatus(true, false);
      updateOfflineBanner();
      if (!simulatedOffline) flushQueue();
    };
    ws.onclose = () => {
      setStatus(false);
      updateOfflineBanner();
      setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "stage") {
        advancePipeline(data.stage, data);
        return;
      }

      const pending = thread.querySelector(".msg.pending");
      if (pending) pending.remove();
      sendBtn.disabled = false;

      if (data.type === "error") {
        appendMessage("system", data.error);
        return;
      }
      if (data.type !== "assistant_message") return;

      appendMessage("assistant", data.reply);
      setStatus(true, data.mockMode);
      updateRail(data);
    };
  }

  function updateRail(data) {
    const c = data.classification || {};
    fields.language.textContent = LANG_NAMES[c.language] || c.language || "—";
    fields.intent.textContent = c.intent || "—";
    fields.category.textContent = c.category || "—";

    fields.urgency.textContent = c.urgency || "—";
    fields.urgency.className = `badge badge-${c.urgency || "low"}`;
    fields.sentiment.textContent = c.sentiment || "—";
    fields.sentiment.className = `badge badge-${c.sentiment || "neutral"}`;

    const pct = Math.round((c.confidence || 0) * 100);
    fields.confidence.style.width = `${pct}%`;
    updateCase(c.case, c.decision);

    escalationBox.classList.toggle("on", !!data.escalated);
    escalationBox.textContent = data.escalated
      ? "Escalated to a human agent — urgency or model confidence crossed the threshold."
      : "No escalation on this session yet.";

    queueNote.textContent =
      data.queueDepth > 0
        ? `Rate-limit queue: ${data.queueDepth} request(s) waiting · reply took ${data.latencyMs}ms`
        : `Rate-limit queue: idle · reply took ${data.latencyMs}ms`;
  }

  function updateCase(caseData = {}, decision = {}) {
    const entities = caseData.entities || {};
    const ready = caseData.ready === true;
    caseCard.classList.toggle("ready", ready);
    caseStatus.textContent = ready ? "Ready for human routing" : "Needs one more fact";
    caseSummary.textContent = caseData.summary || "No case summary extracted.";
    caseIssue.textContent = caseData.issueType || "—";
    caseAction.textContent = caseData.requestedAction || "—";
    caseReference.textContent = entities.referenceId || "—";
    caseLocation.textContent = entities.location || "—";
    caseNext.textContent = ready
      ? "Evidence threshold met. An operator can now route this case without guessing."
      : caseData.nextQuestion || "Setu needs one more detail before routing this case.";
    caseDecision.textContent = decision.route
      ? `Decision kernel: ${decision.route} · ${decision.humanReview ? "human review" : "automated route"} · ${Math.round((decision.confidence || 0) * 100)}% confidence${decision.reason ? ` · ${decision.reason}` : ""}`
      : "Decision kernel is waiting for evidence.";
  }

  function sendMessage(text, opts = {}) {
    if (!text.trim()) return;

    if (isOffline() && !opts.fromQueue) {
      const q = loadQueue();
      const id = "q-" + Math.random().toString(36).slice(2, 9);
      q.push({ id, text, ts: Date.now() });
      saveQueue(q);

      const bubble = appendMessage("queued", text);
      bubble.dataset.qid = id;
      const tag = document.createElement("span");
      tag.className = "queued-tag";
      tag.textContent = "Queued — will send when back online";
      bubble.appendChild(tag);

      appendMessage("local-fallback", localFallbackReply(text)).innerHTML += '<span class="fallback-tag">Local offline assistant — not from Sarvam</span>';
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    resetPipeline();
    appendMessage("user", text);
    appendMessage("pending", "Setu is thinking…");
    sendBtn.disabled = true;
    ws.send(JSON.stringify({ type: "user_message", sessionId, message: text }));
  }

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    sendMessage(text);
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => sendMessage(chip.dataset.sample));
  });

  // ---------- voice input ----------
  // Uses the browser's built-in speech recognition (Web Speech API) — free,
  // client-side, and never touches Sarvam's paid speech-to-text endpoint.
  // Sarvam's own pitch is voice-first AI for India; this is the cheapest
  // possible way to make the demo actually feel like that instead of just
  // being a text box with a translation trick behind it.
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;

  if (!SpeechRecognitionImpl) {
    micBtn.classList.add("unsupported");
    micBtn.disabled = true;
    micBtn.title = "Voice input is not supported in this browser. Try Chrome or Edge.";
    voiceStatus.textContent = "Voice unavailable in this browser";
  } else {
    recognizer = new SpeechRecognitionImpl();
    recognizer.continuous = false;
    recognizer.interimResults = true;

    recognizer.onstart = () => {
      listening = true;
      micBtn.classList.add("listening");
      micBtn.setAttribute("aria-label", "Stop listening");
      voiceStatus.textContent = "Listening… speak now";
    };
    recognizer.onend = () => {
      listening = false;
      micBtn.classList.remove("listening");
      micBtn.setAttribute("aria-label", "Speak your message");
      if (!voiceStatus.textContent.startsWith("Voice error")) voiceStatus.textContent = "Voice input ready";
    };
    recognizer.onerror = (event) => {
      listening = false;
      micBtn.classList.remove("listening");
      const messages = {
        "not-allowed": "Microphone blocked. Allow mic access for localhost in browser settings.",
        "service-not-allowed": "Speech service blocked. Try Chrome on localhost.",
        "no-speech": "Voice error: no speech detected. Try again.",
        "audio-capture": "Voice error: no microphone was found or it is busy.",
      };
      voiceStatus.textContent = messages[event.error] || "Voice error: check microphone permissions and try again.";
    };
    recognizer.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i];
        if (chunk.isFinal) finalText += chunk[0].transcript;
        else interimText += chunk[0].transcript;
      }
      input.value = (finalText || interimText).trim();
      if (finalText.trim()) {
        recognizer.stop();
        sendMessage(finalText.trim());
        input.value = "";
      }
    };

    micBtn.addEventListener("click", () => {
      if (listening) {
        recognizer.stop();
        return;
      }
      recognizer.lang = voiceLangSelect.value;
      voiceStatus.textContent = "Requesting microphone access…";
      try {
        recognizer.start();
      } catch (error) {
        if (error.name === "NotAllowedError") {
          voiceStatus.textContent = "Microphone blocked. Allow access and try again.";
        } else {
          voiceStatus.textContent = "Voice error: try clicking the mic again.";
        }
      }
    });
  }

  connect();
  updateOfflineBanner();
})();
