const OPENAI_BASE = "https://api.openai.com/v1";

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").trim();
  const value = allowed && origin === allowed ? origin : allowed ? "null" : origin || "*";
  return {
    "Access-Control-Allow-Origin": value,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin, env) });
}

async function openai(path, env, init = {}) {
  const res = await fetch(OPENAI_BASE + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `OpenAI HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

function outputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const c of item?.content || []) if (c?.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("\n").trim();
}

async function newConversation(env) {
  const c = await openai("/conversations", env, {
    method: "POST",
    body: JSON.stringify({ metadata: { app: "fitpulse", version: "9" } })
  });
  return c.id;
}

const INSTRUCTIONS = `Ты — FitPulse GPT, персональный фитнес-тренер внутри приложения.
Отвечай по-русски, компактно, конкретно и по фактическим данным пользователя.
Главные задачи: анализ прогрессии нагрузки, сравнение тренировок, рекомендации следующей тренировки, техника, восстановление и общие спортивные ориентиры по питанию.
Никогда не выдумывай веса, повторения, замеры или прошлые результаты. Если данных мало — прямо скажи, чего именно не хватает.
Не ставь медицинские диагнозы и не назначай лечение. Если пользователь сообщает о боли, головокружении, необычных симптомах или плохом самочувствии, не советуй тренироваться через это.
Рабочие веса определяй только по фактической истории тренировок, а не только по возрасту, росту или массе тела.
Помни долгосрочные факты о целях и прогрессе из Conversation и из переданного FitPulse memory.
В КОНЦЕ каждого ответа добавляй отдельной строкой: FITPULSE_MEMORY: <очень краткая актуальная память до 900 символов: цель, важные текущие показатели, тренды и договорённости>. Не добавляй туда медицинские предположения.`;

async function respondWithConversation(body, env) {
  let conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  if (!conversationId) conversationId = await newConversation(env);
  const snapshot = JSON.stringify(body.context || {}).slice(0, 45000);
  const memory = String(body.memory || "").slice(0, 5000);
  const imported = String(body.importedContext || "").slice(0, 12000);
  const message = String(body.message || "").trim();
  if (!message) throw new Error("Пустой запрос");
  const inputText = `Режим: ${body.purpose || "chat"}\nТекущий снимок FitPulse: ${snapshot}\nТекущая долговременная память FitPulse: ${memory || "нет"}\nИмпортированный старый контекст из ChatGPT пользователя: ${imported || "нет"}\nЗапрос пользователя/событие: ${message}`;
  const payload = {
    model: env.OPENAI_MODEL || "gpt-6-luna",
    conversation: conversationId,
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content: [{ type: "input_text", text: inputText }] }],
    max_output_tokens: 1100,
    store: true
  };
  try {
    const r = await openai("/responses", env, { method: "POST", body: JSON.stringify(payload) });
    return { text: outputText(r), conversationId, model: r.model || payload.model };
  } catch (e) {
    // If a local Conversation id was lost/invalid, recover once with a fresh conversation.
    if (conversationId && (e.status === 404 || e.status === 400)) {
      conversationId = await newConversation(env);
      payload.conversation = conversationId;
      const r = await openai("/responses", env, { method: "POST", body: JSON.stringify(payload) });
      return { text: outputText(r), conversationId, model: r.model || payload.model };
    }
    throw e;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").trim();
    if (allowed && origin && origin !== allowed) return json({ error: "Origin not allowed" }, 403, origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, env) });
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: Boolean(env.OPENAI_API_KEY), model: env.OPENAI_MODEL || "gpt-6-luna" }, env.OPENAI_API_KEY ? 200 : 503, origin, env);
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured" }, 503, origin, env);
      try {
        const body = await request.json();
        const result = await respondWithConversation(body || {}, env);
        return json(result, 200, origin, env);
      } catch (e) {
        return json({ error: e?.message || "GPT request failed" }, 500, origin, env);
      }
    }
    return json({ error: "Not found" }, 404, origin, env);
  }
};
