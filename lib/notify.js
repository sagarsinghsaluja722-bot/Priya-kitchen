// WhatsApp alert to the owner when a paid order comes in.
// Two options (set WHATSAPP_PROVIDER in .env):
//   callmebot — free, quickest to set up, sends to your own WhatsApp number
//   meta      — official WhatsApp Business Cloud API (needs an approved message template)

const OWNER = (process.env.OWNER_WHATSAPP || '').replace(/\D/g, '');
const PROVIDER = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();

function oneLine(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ', ').replace(/ {2,}/g, ' ').trim();
}

function itemsText(order) {
  return order.items.map((l) => `${l.qty} x ${l.name}`).join(', ');
}

function orderMessage(order) {
  const upi = order.status === 'payment_submitted';
  const cod = order.payMethod === 'cod';
  const lines = [
    upi ? `New order ${order.code} - CHECK UPI PAYMENT` : cod ? `New order ${order.code} - CASH ON DELIVERY` : `New paid order ${order.code}`,
    `Customer: ${order.name} (+91 ${order.phone})`,
    `Items: ${itemsText(order)}`,
    upi ? `Amount: Rs ${order.total} · UPI ref (UTR): ${order.utr}` : cod ? `Collect Rs ${order.total} in cash at delivery` : `Total: Rs ${order.total} (paid online)`,
    `Address: ${oneLine(order.address)}`
  ];
  if (upi) lines.push('Check this amount in your UPI/bank app, then tap "Payment received" on the admin page.');
  if (order.note) lines.push(`Note: ${oneLine(order.note)}`);
  if (process.env.PUBLIC_URL) lines.push(`Manage: ${process.env.PUBLIC_URL.replace(/\/$/, '')}/admin`);
  return lines.join('\n');
}

async function viaCallMeBot(text) {
  const key = process.env.CALLMEBOT_API_KEY;
  if (!key) throw new Error('CALLMEBOT_API_KEY is not set');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${OWNER}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok || /error/i.test(body.slice(0, 300))) throw new Error('CallMeBot: ' + r.status + ' ' + body.slice(0, 200));
}

async function viaMeta(order, text) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID are not set');
  const template = process.env.META_WA_TEMPLATE;
  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to: OWNER,
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.META_WA_TEMPLATE_LANG || 'en' },
          components: [{
            type: 'body',
            parameters: [order.code, `${order.name} (+91 ${order.phone})`, itemsText(order), String(order.total), oneLine(order.address)]
              .map((t) => ({ type: 'text', text: oneLine(t).slice(0, 900) }))
          }]
        }
      }
    : { messaging_product: 'whatsapp', to: OWNER, type: 'text', text: { body: text } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error('Meta WhatsApp: ' + r.status + ' ' + (await r.text()).slice(0, 300));
}

async function notifyOwner(order) {
  const text = orderMessage(order);
  if (!OWNER) {
    console.warn('[whatsapp] OWNER_WHATSAPP is not set; message not sent:\n' + text);
    return false;
  }
  if (PROVIDER === 'callmebot') await viaCallMeBot(text);
  else if (PROVIDER === 'meta') await viaMeta(order, text);
  else {
    console.log('[whatsapp] No WhatsApp provider set. This message would be sent to +' + OWNER + ':\n' + text);
    return false;
  }
  console.log(`[whatsapp] alert sent for ${order.code}`);
  return true;
}

module.exports = { notifyOwner, orderMessage, providerName: () => PROVIDER || 'none' };
