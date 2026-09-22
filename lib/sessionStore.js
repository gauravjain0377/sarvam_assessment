"use strict";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle -> evicted
const MAX_HISTORY_TURNS = 6; // trimmed context sent back to the model each turn
const HIGH_URGENCY_ESCALATION_THRESHOLD = "high";
const LOW_CONFIDENCE_ESCALATION_THRESHOLD = 0.35;

class SessionStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.sessions = new Map();
    this.cleanupTimer = setInterval(() => this._evictStale(), 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  _evictStale() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }

  getOrCreate(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        history: [],
        turns: [],
        escalated: false,
        escalatedAt: null,
        language: null,
        latestCase: null,
        caseStatus: "needs-info",
        latestDecision: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /** Trimmed conversation history to feed back to the model — keeps token/cost bounded on long threads. */
  getHistoryForModel(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.history.slice(-MAX_HISTORY_TURNS * 2);
  }

  recordTurn(sessionId, { userMessage, reply, classification, latencyMs }) {
    const session = this.getOrCreate(sessionId);
    session.lastActivity = Date.now();
    session.history.push({ role: "user", content: userMessage });
    session.history.push({ role: "assistant", content: reply });
    if (classification.language && classification.language !== "unknown") {
      session.language = classification.language;
    }
    session.latestCase = classification.case || null;
    session.latestDecision = classification.decision || null;
    session.caseStatus = classification.case?.ready ? "ready-for-routing" : "needs-info";

    const shouldEscalate =
      classification.urgency === HIGH_URGENCY_ESCALATION_THRESHOLD ||
      classification.confidence < LOW_CONFIDENCE_ESCALATION_THRESHOLD;
    if (shouldEscalate && !session.escalated) {
      session.escalated = true;
      session.escalatedAt = Date.now();
    }

    session.turns.push({
      ts: Date.now(),
      userMessage,
      reply,
      classification,
      latencyMs,
    });

    return session;
  }

  listSessions() {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        language: s.language,
        turnCount: s.turns.length,
        escalated: s.escalated,
        lastCategory: s.turns[s.turns.length - 1]?.classification?.category ?? null,
        lastSentiment: s.turns[s.turns.length - 1]?.classification?.sentiment ?? null,
        caseStatus: s.caseStatus,
        latestCase: s.latestCase,
        latestDecision: s.latestDecision,
      }));
  }

  getStats() {
    const sessions = [...this.sessions.values()];
    const allTurns = sessions.flatMap((s) => s.turns);

    const byLanguage = {};
    const byCategory = {};
    const bySentiment = { positive: 0, neutral: 0, negative: 0 };
    let latencySum = 0;

    for (const turn of allTurns) {
      const c = turn.classification;
      byLanguage[c.language] = (byLanguage[c.language] || 0) + 1;
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
      if (bySentiment[c.sentiment] !== undefined) bySentiment[c.sentiment] += 1;
      latencySum += turn.latencyMs || 0;
    }

    return {
      activeSessions: sessions.length,
      totalQueries: allTurns.length,
      escalatedSessions: sessions.filter((s) => s.escalated).length,
      readyCases: sessions.filter((s) => s.caseStatus === "ready-for-routing").length,
      avgLatencyMs: allTurns.length ? Math.round(latencySum / allTurns.length) : 0,
      byLanguage,
      byCategory,
      bySentiment,
    };
  }
}

module.exports = { SessionStore };
