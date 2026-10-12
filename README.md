# Priya Kitchen — Ordering Website

A complete, real-time tiffin ordering website:

- **Customer login with OTP** on their mobile number (first time: name + address, saved for next time)
- **Menu & cart** for tiffins and add-ons
- **Prepaid only** — UPI, cards and net banking through **Razorpay**
- **WhatsApp alert to your number (+91 91407 62014)** the moment an order is paid
- **“Your orders” page** where customers track each order **live**: Placed → Accepted → Being prepared → Out for delivery → Delivered
- **Admin page** (`/admin`) for you: new orders pop up with a sound, one tap to move each order to the next step, edit menu and prices, set delivery charge, pause orders

No extra packages to install. It needs only **Node.js 22.13 or newer**.

---

## 1. Try it on your computer (test mode)

1. Install Node.js 22 (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm run demo
   ```
   (On Windows Command Prompt: `set DEMO_MODE=true&& node server.js` — no space before `&&`)
3. Open http://localhost:3000 — place a test order. The OTP is shown on screen and the payment is simulated.
4. Open http://localhost:3000/admin — password `admin123` — and move the order through the steps. Watch the customer page update by itself.

Test mode is only for trying things out. **Never turn it on for the real site.**

---

## 2. Accounts you need to create (one time)

These need your own PAN / bank details, so you must sign up yourself. Keep every key private.

### A. Razorpay (payments)
1. Sign up at https://razorpay.com and complete KYC (PAN, bank account, business details).
2. Dashboard → **Account & Settings → API Keys** → generate keys. Copy **Key ID** and **Key Secret**.
   - Start with **Test Mode** keys (`rzp_test_...`) to test with fake cards/UPI, then switch to **Live Mode** keys.
3. Dashboard → **Webhooks → Add new webhook**
   - URL: `https://YOUR-WEBSITE/api/razorpay/webhook`
   - Secret: type any long secret and copy it
   - Event: tick **order.paid**
   This makes sure an order is still placed even if the customer closes the browser right after paying.

### B. 2Factor.in (OTP SMS)
1. Sign up at https://2factor.in and buy a small SMS/OTP pack.
2. Copy your **API key** from the dashboard.
3. If 2Factor asks you to register a template / DLT, follow their steps and put the template name in `TWOFACTOR_TEMPLATE`.

### C. WhatsApp alerts to your number — choose one

**Option 1 — CallMeBot (free, 5 minutes, recommended to start)**
1. Go to https://www.callmebot.com/blog/free-api-whatsapp-messages/
2. Follow the steps there: from **9140762014**, send the activation message they show to their WhatsApp number.
3. You receive an **API key** on WhatsApp. Put it in `CALLMEBOT_API_KEY` and set `WHATSAPP_PROVIDER=callmebot`.

**Option 2 — Official WhatsApp Business Cloud API (Meta)**
For higher volume. Create an app at https://developers.facebook.com, add WhatsApp, and get a **permanent access token** and **phone number ID**. Create a message template named `new_order_alert` (category: Utility) with this body:

```
New order {{1}} from {{2}}. Items: {{3}}. Total: Rs {{4}} (paid). Address: {{5}}
```

Set `WHATSAPP_PROVIDER=meta`, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE=new_order_alert`.

Even without WhatsApp set up, every paid order appears instantly on your admin page with a sound.

---

## 3. Put it online (Railway — easiest)

1. Create a free account on https://github.com and upload this folder as a new **private** repository.
2. Sign up at https://railway.app → **New Project → Deploy from GitHub repo** → pick the repository.
3. In the service → **Settings → Volumes → Add volume**, mount path `/data`. (This keeps your orders and customers safe when the site restarts.)
4. In **Variables**, add everything from `.env.example`:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATA_DIR` | `/data` |
   | `JWT_SECRET` | any long random text (40+ characters) |
   | `ADMIN_PASSWORD` | a strong password for `/admin` |
   | `OWNER_WHATSAPP` | `919140762014` |
   | `PUBLIC_URL` | your website address |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | from Razorpay |
   | `TWOFACTOR_API_KEY` | from 2Factor |
   | `WHATSAPP_PROVIDER`, `CALLMEBOT_API_KEY` | from step 2C |

5. **Settings → Networking → Generate Domain** gives you a link like `priya-kitchen.up.railway.app`. You can also connect your own domain (e.g. `priyakitchen.in`, bought from GoDaddy/Hostinger).
6. Update the Razorpay webhook URL with your real address.

Railway costs roughly US$5/month. Any host that runs Node.js 22 with a persistent disk works too (Render with a disk, a small VPS, etc.).

---

## 4. Daily use

- Keep **`/admin` open** on your phone or laptop — new orders ring and flash.
- Tap **Accept order → Start preparing → Out for delivery → Mark delivered**. The customer’s “Your orders” page updates instantly.
- **Cancel** only if needed, then refund from the Razorpay dashboard (Payments → select payment → Refund).
- **Menu** tab: add tiffins, change prices, untick “Available” to hide an item for the day.
- **Settings** tab: delivery charge, free delivery above an amount, minimum order, and a switch to pause taking orders.

---

## Files

```
server.js           the server (all website APIs)
lib/db.js           database (saved in DATA_DIR/priya-kitchen.db)
lib/otp.js          OTP login via 2Factor
lib/razorpay.js     payment creation and verification
lib/notify.js       WhatsApp alert to the owner
public/             the customer website and the admin page
menu.json           starting menu (used only on first run — then edit from /admin)
.env.example        list of settings to fill in
```

**Back up** the file `priya-kitchen.db` from your data folder now and then — it holds all customers and orders.
