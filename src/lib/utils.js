export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

export function isSocketHangupError(err) {
  const msg = (err?.message || '').toLowerCase();
  return err?.code === 'ECONNRESET' || 
         err?.code === 'ENOTFOUND' || 
         err?.code === 'ETIMEDOUT' ||
         msg.includes('socket hang up') ||
         msg.includes('network') ||
         msg.includes('connection');
}

export async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const idsStr = process.env.TELEGRAM_CHAT_IDS;

  if (!token || !idsStr) return;

  const ids = idsStr.split(',').map(id => id.trim()).filter(id => id);

  for (const chatId of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error('Failed to send telegram message', e);
    }
  }
}