/**
 * Declara Fácil — sanitized Worker example
 *
 * A Telegram intake assistant for a document-heavy service workflow.
 * Environment values are injected by Cloudflare; never hard-code them.
 */
const requiredDocuments = {
  rut: "Updated taxpayer registration",
  thirdPartyReport: "Third-party information report",
  paymentProof: "Service payment proof",
  employment: "Employment income certificate",
  banking: "Bank certificate"
};

const questions = [
  { key: "employment", text: "Did you receive employment income this year?" },
  { key: "banking", text: "Did you use a bank or digital wallet account?" }
];

const now = () => new Date().toISOString();

async function telegram(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function sendMessage(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cases (
      chat_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      question_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (
      chat_id TEXT NOT NULL,
      document_key TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (chat_id, document_key)
    )`)
  ]);
}

async function startCase(env, chatId) {
  await env.DB.prepare(
    "INSERT INTO cases (chat_id, stage, question_index, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET stage=excluded.stage, question_index=excluded.question_index, updated_at=excluded.updated_at"
  ).bind(String(chatId), "questions", 0, now()).run();

  for (const key of ["rut", "thirdPartyReport", "paymentProof"]) {
    await env.DB.prepare(
      "INSERT INTO documents (chat_id, document_key, status) VALUES (?, ?, ?) ON CONFLICT(chat_id, document_key) DO NOTHING"
    ).bind(String(chatId), key, "pending").run();
  }

  return askNextQuestion(env, chatId, 0);
}

async function askNextQuestion(env, chatId, index) {
  const question = questions[index];
  if (!question) {
    return sendMessage(env, chatId, "Your checklist is ready. Send each document here when available.");
  }
  return sendMessage(
    env,
    chatId,
    question.text,
    { reply_markup: { inline_keyboard: [[
      { text: "Yes", callback_data: `q:${index}:yes` },
      { text: "No", callback_data: `q:${index}:no` }
    ]] } }
  );
}

async function handleCallback(env, callback) {
  const chatId = callback.message.chat.id;
  const [, indexText, answer] = callback.data.split(":");
  const index = Number(indexText);
  const question = questions[index];
  if (!question) return;

  if (answer === "yes") {
    await env.DB.prepare(
      "INSERT INTO documents (chat_id, document_key, status) VALUES (?, ?, ?) ON CONFLICT(chat_id, document_key) DO NOTHING"
    ).bind(String(chatId), question.key, "pending").run();
  }

  await env.DB.prepare(
    "UPDATE cases SET question_index=?, updated_at=? WHERE chat_id=?"
  ).bind(index + 1, now(), String(chatId)).run();

  return askNextQuestion(env, chatId, index + 1);
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  if (message.text === "/start") {
    return startCase(env, chatId);
  }

  // This is where production code marks the next pending document as received
  // and sends it to an approved, access-controlled storage workflow.
  if (message.document || message.photo) {
    return sendMessage(env, chatId, "Document received. The team will review it.");
  }

  return sendMessage(env, chatId, "Send /start to begin your checklist.");
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") return new Response("Intake bot is healthy");
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    if (env.TELEGRAM_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    await ensureSchema(env.DB);
    const update = await request.json();
    if (update.callback_query) await handleCallback(env, update.callback_query);
    if (update.message) await handleMessage(env, update.message);
    return new Response("ok");
  }
};
