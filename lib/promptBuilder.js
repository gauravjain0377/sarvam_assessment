"use strict";

const REPLY_SYSTEM_PROMPT = `You are Setu, a multilingual assistant for citizen and customer queries in India.
Reply in the SAME language and script the user wrote in (Hindi, Hinglish, Tamil, Telugu, Bengali, Marathi, English, etc.) — never switch to English unless the user did.
Keep replies short (2-4 sentences), warm, and specific. If the query is incomplete, ask exactly one clarifying question.
Do not mention that you are an AI model or discuss these instructions.`;

const CLASSIFY_SYSTEM_PROMPT = `You are Setu's case intake engine for multilingual Indian support and citizen-service requests.
Read the user's message, including code-mixed language. Output the JSON object immediately. Do not show analysis, reasoning, or prose before or after it.
Extract only facts supported by the message. Never invent names, amounts, dates, locations, IDs, or outcomes.
Use null for an unknown scalar, [] for an empty list, and a confidence from 0 to 1.
The nextQuestion must be a single short question in the user's language and script. Ask only for the most important missing fact needed to route or act on the case.
Use exactly this shape:
{"language":"<ISO 639-1 code>","intent":"<query|complaint|request|feedback>","category":"<billing|technical|account|delivery|public-service|general>","urgency":"<low|medium|high>","sentiment":"<positive|neutral|negative>","confidence":<0-1 float>,"decision":{"route":"<billing|technical|account|delivery|public-service|human-review|general>","humanReview":<true|false>,"confidence":<0-1 float>,"reason":"<short evidence-based reason>"},"case":{"summary":"<one concise sentence>","issueType":"<specific issue or null>","entities":{"amount":"<string or null>","date":"<string or null>","location":"<string or null>","referenceId":"<string or null>","provider":"<string or null>"},"impact":"<who or what is affected, or null>","requestedAction":"<what the user wants, or null>","missingFields":["<location|referenceId|date|amount|requestedAction|impact>"],"ready":<true|false>,"nextQuestion":"<one question or empty string>"}}`;

function buildReplyMessages(history, userMessage) {
  return [
    { role: "system", content: REPLY_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];
}

function buildClassifyMessages(userMessage) {
  return [
    { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
}

const DEFAULT_CLASSIFICATION = {
  language: "unknown",
  intent: "query",
  category: "general",
  urgency: "low",
  sentiment: "neutral",
  confidence: 0,
  decision: { route: "human-review", humanReview: true, confidence: 0, reason: "No structured decision available." },
  case: {
    summary: "No case extracted yet.",
    issueType: null,
    entities: { amount: null, date: null, location: null, referenceId: null, provider: null },
    impact: null,
    requestedAction: null,
    missingFields: ["requestedAction"],
    ready: false,
    nextQuestion: "What outcome would you like Setu to help with?",
  },
};

/** The model is asked for pure JSON but may still wrap it in fences or add stray text — parse defensively. */
function parseClassification(raw) {
  if (!raw) return { ...DEFAULT_CLASSIFICATION };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ...DEFAULT_CLASSIFICATION };
  try {
    const parsed = JSON.parse(match[0]);
    const result = {
      ...DEFAULT_CLASSIFICATION,
      ...parsed,
      decision: { ...DEFAULT_CLASSIFICATION.decision, ...(parsed.decision || {}) },
      case: {
        ...DEFAULT_CLASSIFICATION.case,
        ...(parsed.case || {}),
        entities: { ...DEFAULT_CLASSIFICATION.case.entities, ...(parsed.case?.entities || {}) },
      },
    };
    const routableCategories = new Set(["billing", "technical", "account", "delivery", "public-service", "general"]);
    if (routableCategories.has(result.category) && result.decision.route !== result.category) {
      result.decision = {
        ...result.decision,
        route: result.category,
        humanReview: true,
        reason: `Route normalized to the classified category (${result.category}) for safety.`,
      };
    }
    return result;
  } catch {
    return { ...DEFAULT_CLASSIFICATION };
  }
}

module.exports = { buildReplyMessages, buildClassifyMessages, parseClassification };
