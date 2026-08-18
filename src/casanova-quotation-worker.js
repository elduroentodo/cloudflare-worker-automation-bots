/**
 * Casanova quotation bot — sanitized Worker example
 *
 * Collects quote inputs in Telegram, persists session state in D1,
 * and calculates totals before a production PDF-delivery step.
 */
const now = () => new Date().toISOString();

const money = value => Number(value).toLocaleString("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0
});

const parsePositiveNumber = value => {
  const parsed = Number(String(value).replace(/[$.\s]/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function telegram(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const send = (env, chatId, text, extra = {}) =>
  telegram(env, "sendMessage", { chat_id: chatId, text, ...extra });

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS quote_sessions (
    chat_id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    recipient TEXT,
    item_name TEXT,
    unit_price REAL,
    items_json TEXT NOT NULL DEFAULT '[]',
    include_vat INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`).run();
}

async function save(db, session) {
  return db.prepare(
    `INSERT INTO quote_sessions
      (chat_id, stage, recipient, item_name, unit_price, items_json, include_vat, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
      stage=excluded.stage, recipient=excluded.recipient, item_name=excluded.item_name,
      unit_price=excluded.unit_price, items_json=excluded.items_json,
      include_vat=excluded.include_vat, updated_at=excluded.updated_at`
  ).bind(
    String(session.chat_id), session.stage, session.recipient || "",
    session.item_name || "", session.unit_price || null,
    session.items_json || "[]", session.include_vat ? 1 : 0, now()
  ).run();
}

async function session(db, chatId) {
  return db.prepare("SELECT * FROM quote_sessions WHERE chat_id=?")
    .bind(String(chatId)).first();
}

function totals(items, includeVat) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const vat = includeVat ? subtotal * 0.19 : 0;
  return { subtotal, vat, total: subtotal + vat };
}

async function preview(env, current) {
  const items = JSON.parse(current.items_json);
  const result = totals(items, Boolean(current.include_vat));
  const lines = items.map(item =>
    `• ${item.quantity} × ${item.name}: ${money(item.quantity * item.unit_price)}`
  ).join("\n");

  return send(env, current.chat_id,
    `Quote preview for ${current.recipient}\n\n${lines}\n\nSubtotal: ${money(result.subtotal)}\nVAT: ${money(result.vat)}\nTotal: ${money(result.total)}\n\nA production version generates and sends a PDF after review.`
  );
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  let current = await session(env.DB, chatId);

  if (text === "/start") {
    current = { chat_id: chatId, stage: "recipient", items_json: "[]", include_vat: false };
    await save(env.DB, current);
    return send(env, chatId, "Who should receive this quotation?");
  }
  if (!current) return send(env, chatId, "Send /start to create a quotation.");

  if (current.stage === "recipient") {
    current.recipient = text; current.stage = "item_name";
    await save(env.DB, current);
    return send(env, chatId, "What is the first service or product?");
  }
  if (current.stage === "item_name") {
    current.item_name = text; current.stage = "price";
    await save(env.DB, current);
    return send(env, chatId, "What is the unit price? Example: 250000");
  }
  if (current.stage === "price") {
    const price = parsePositiveNumber(text);
    if (!price) return send(env, chatId, "Please send a positive numeric price.");
    current.unit_price = price; current.stage = "quantity";
    await save(env.DB, current);
    return send(env, chatId, "What quantity is required?");
  }
  if (current.stage === "quantity") {
    const quantity = parsePositiveNumber(text);
    if (!quantity) return send(env, chatId, "Please send a positive quantity.");
    const items = JSON.parse(current.items_json);
    items.push({ name: current.item_name, unit_price: current.unit_price, quantity });
    current.items_json = JSON.stringify(items);
    current.stage = "complete";
    await save(env.DB, current);
    return preview(env, current);
  }
  return send(env, chatId, "This quotation is ready. Send /start to begin another.");
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") return new Response("Quotation bot is healthy");
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (env.TELEGRAM_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    await ensureSchema(env.DB);
    const update = await request.json();
    if (update.message) await handleMessage(env, update.message);
    return new Response("ok");
  }
};
