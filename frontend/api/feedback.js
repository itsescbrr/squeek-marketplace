// Vercel serverless function: forward marketplace feedback to a Telegram bot.
// Token + chat id live in Vercel env vars (TG_BOT_TOKEN / TG_CHAT_ID), never in the browser.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method not allowed' }); return; }

  let body = {};
  try { body = req.body || {}; } catch (_) {}

  const type = String(body.type || 'General Feedback');
  const message = String(body.message || '').trim();
  const contact = String(body.contact || '').trim();
  const page = String(body.page || '').trim();

  if (!message) { res.status(400).json({ ok: false, error: 'empty message' }); return; }

  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) { res.status(500).json({ ok: false, error: 'feedback bot not configured' }); return; }

  const lines = [
    '\uD83D\uDD14 <b>' + esc(type) + '</b>',
    esc(message),
  ];
  if (contact) lines.push('Contact: ' + esc(contact));
  if (page) lines.push('Page: ' + page);

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (j && j.ok) { res.status(200).json({ ok: true }); return; }
    res.status(502).json({ ok: false, error: (j && j.description) || 'telegram error' });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}