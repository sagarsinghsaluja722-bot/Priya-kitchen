# Priya Kitchen — Ordering Website

Live site: https://priya-kitchen-production.up.railway.app
Admin page: https://priya-kitchen-production.up.railway.app/admin

## What it does

**Customers**
- See the menu (tiffins and add-ons) and add items to a cart
- Log in with their mobile number and a 4-digit PIN (first time: name and delivery address, saved for next time)
- Check out: review items, change address, add a note, choose how to pay
  - Cash on delivery
  - Google Pay / PhonePe / Paytm / other UPI / cards — through Razorpay, confirmed automatically
- See "Order placed — reaches you within 30 minutes"

**Owner (admin page)**
- **Orders** — new orders appear instantly with a sound; move each order through Accepted → Preparing → Out for delivery → Delivered, or cancel; one tap to WhatsApp the customer
- **Menu** — add items, change names/prices/descriptions/categories, hide an item for the day, delete items. Customers see changes immediately.
- **Settings** — take orders on/off, cash on delivery on/off, delivery time, delivery charge, free-delivery limit, minimum order, reset a customer's PIN
- **Data** — totals, download a full backup, download all orders as a spreadsheet

## Where the data lives

Everything — customers, menu, orders, settings — is stored in one SQLite database file:

```
/data/priya-kitchen.db        (Railway volume "priya-kitchen-data", mounted at /data)
/data/backups/                daily backup copies (last 14 kept)
```

- The Railway **volume** is permanent storage: data survives restarts, redeploys and code updates.
- A **backup copy** is saved automatically once a day. You can also make one any time (Admin → Data → Back up now).
- **Download full backup** (Admin → Data) gives you the whole database as one file — keep a copy off the server (phone / Google Drive) every week.
- **Download orders (Excel)** gives every order as a CSV spreadsheet.
- To restore a backup: in Railway, stop the service, replace `/data/priya-kitchen.db` with the backup file, start the service.

Unfinished payment attempts are kept in the database but never shown as orders.

## Payments

| Razorpay keys in Railway | What customers see |
|---|---|
| none | Cash on delivery (and direct UPI to `UPI_ID`, with owner confirmation) |
| **test** keys (`rzp_test_…`) | **Cash on delivery only.** Online payment is hidden so no one can "pay" with test money. The owner can switch on *Allow Razorpay TEST payments* in Settings to try it. |
| **live** keys (`rzp_live_…`) | GPay / PhonePe / Paytm / UPI / cards — the app opens with the amount filled in and the order is placed automatically once paid |

The server confirms each payment with Razorpay itself: right after payment, while the customer is in the app, through the webhook, and every minute for recent unpaid orders — so a paid order is placed even if the customer closes the page.

**Razorpay webhook (recommended):** Dashboard → Webhooks → Add: URL `https://priya-kitchen-production.up.railway.app/api/razorpay/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, event `order.paid`.

## Settings (Railway → Priya-kitchen → Variables)

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for /admin |
| `JWT_SECRET` | Long random text that keeps logins secure — never change it casually (logs everyone out) |
| `DATA_DIR` | `/data` — where the database is stored (the volume) |
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | The site address |
| `OWNER_WHATSAPP` | `919140762014` — owner alerts |
| `WHATSAPP_PROVIDER`, `CALLMEBOT_API_KEY` | Owner WhatsApp alerts (CallMeBot, free) |
| `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_CUSTOMER_TEMPLATE` | Optional: automatic WhatsApp "order placed" message to customers (WhatsApp Business API) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Online payments |
| `UPI_ID`, `UPI_NAME` | Fallback direct-UPI payee when Razorpay is not set |

## Run it on a computer (for testing)

Needs Node.js 22.13 or newer. No packages to install.

```
DEMO_MODE=true node server.js
```

Open http://localhost:3000 (admin: http://localhost:3000/admin, password `admin123` in demo mode).

## Files

```
server.js          the server and all website APIs
lib/db.js          database, backups, data overview
lib/razorpay.js    Razorpay orders, payment checks, webhooks
lib/notify.js      WhatsApp messages (owner alert, customer confirmation)
lib/otp.js         SMS OTP login (optional; PIN login is used when not set up)
public/            customer website (index.html, app.js) and admin page (admin.html, admin.js)
menu.json          starting menu, used only the very first time
```
