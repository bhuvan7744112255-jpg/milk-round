# Milk Round — deployment guide

Three apps (Admin, Customer, Delivery Partner) on one shared Supabase backend,
deployed as static PWAs + serverless functions on Vercel. No build step, no
framework — plain HTML/CSS/JS, per the original spec's philosophy.

## How it's wired together (read this first)

Rather than calling Supabase directly from the browser with Row Level
Security policies per role, every table in `supabase/schema.sql` has RLS
turned **on with zero policies** — meaning the public/anon key can't touch
anything. All three apps talk only to this project's own `/api/*` serverless
functions, which use the Supabase **service role** key (server-side only) and
enforce who can do what in code. This is a deliberate simplification for a
small team: one place to audit for authorization bugs, no secrets ever reach
a browser, and no per-role RLS policy set to get subtly wrong.

Login is OTP-only (MSG91), for all three apps including Admin — an admin
phone number just needs to be on an allowlist (`ADMIN_PHONES`). A session is
a signed, httpOnly cookie; there's no separate password to manage.

## What I added beyond the literal spec

The spec defines data model and business rules but doesn't say **how a daily
subscription delivery becomes an Order row** for the Partner app to act on.
I added `api/cron/generate-daily-orders.js`, run once a day by Vercel Cron
(see `vercel.json`), which turns every Active subscription with
`days_remaining > 0` into today's Order. If you'd rather trigger this some
other way (a Supabase Edge Function, a manual admin button), it's one
self-contained file.

The spec also doesn't define how much a delivery partner is paid per stop.
`PARTNER_PAYOUT_PER_DELIVERY` (env var, defaults to ₹15) is a flat placeholder
so the Earnings screen shows something real — swap it for your actual
commission model whenever you have one.

Everything else — wallet/subscription math, mid-cycle change staging,
instant-delivery admin-gating and auto-disable, haversine route sorting,
OND/PD/revenue-lost rollups, procurement vs. dispatch — follows §5 of the
spec as written.

---

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project. Pick a region close to
   your users (Mumbai/Singapore for an India launch).
2. Once it's up: **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and run it. This creates every table, locks them
   down with RLS, and seeds one example zone (Jubilee Hills) and three
   products — edit or delete that seed data once you're ready.
3. **Project Settings → API**: copy the **Project URL** and the
   **`service_role`** key (not `anon`). You'll need both for Vercel. The
   service_role key is a secret — never put it in client code or in chat.
4. **Storage** (for the two hero videos): create a public bucket named
   `media`, then upload `milk_animation.mp4` and `vegitable_animation_.mp4`
   into it. Copy each file's public URL — that's what `MILK_VIDEO_URL` and
   `VEGETABLE_VIDEO_URL` should point to.

## 2. Set up MSG91 (OTP)

1. [msg91.com](https://msg91.com) → sign up, verify your sender.
2. Dashboard → **OTP** → create an OTP template. Note the **template ID**.
3. **Settings → API Keys** → copy your **Auth Key**.
4. New accounts start in DEMO mode and may have IP restrictions on the
   authkey — check the dashboard if OTPs stop arriving after you deploy;
   you may need to allow Vercel's outbound IPs or disable IP security on the
   key.

## 3. Set up Razorpay

1. [razorpay.com](https://razorpay.com) → sign up, complete KYC when you're
   ready to go live (test mode works immediately without it).
2. **Settings → API Keys** → Generate Test Key initially. You'll get a
   **Key ID** (`rzp_test_...`, safe to expose) and a **Key Secret** (never
   expose this).
3. Switch to live keys the same way once you're ready to take real payments.

## 4. Push this project to GitHub

```bash
cd milk-round
git init
git add .
git commit -m "Milk Round v1"
gh repo create milk-round --private --source=. --push
# or: create an empty repo on github.com, then
# git remote add origin <your-repo-url> && git push -u origin main
```

## 5. Deploy to Vercel

1. [vercel.com](https://vercel.com/new) → Import the GitHub repo. Framework
   preset: **Other** (it's static + serverless functions, no framework to
   detect). Leave build command empty.
2. Before the first deploy, go to **Settings → Environment Variables** and
   add everything listed in `.env.example`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from step 1.
   - `APP_SESSION_SECRET` — generate one: `openssl rand -hex 32`.
   - `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` — from step 2.
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — from step 3.
   - `ADMIN_PHONES` — comma-separated 10-digit numbers allowed into `/admin`.
   - `CRON_SECRET` — any random string (`openssl rand -hex 16` works).
   - `PARTNER_PAYOUT_PER_DELIVERY`, `MILK_VIDEO_URL`, `VEGETABLE_VIDEO_URL` —
     optional but recommended.
3. Deploy. Vercel will pick up `vercel.json` automatically (clean URLs,
   rewrites for `/admin` `/customer` `/partner`, and the daily cron).
4. Once deployed, visit `https://your-project.vercel.app` — you'll land on a
   page linking to all three apps.

## 6. Verify the daily cron

**Vercel → your project → Cron Jobs** should show
`/api/cron/generate-daily-orders` scheduled for `30 22 * * *` (22:30 UTC =
04:00 IST — before the morning delivery round; adjust if you want it
earlier/later). You can trigger it manually from that same screen to test
without waiting for the schedule. It's safe to re-run: it skips any
customer+product+date that already has an order.

## 7. Add yourself as admin, then test end to end

1. Put your own phone number in `ADMIN_PHONES`, redeploy (env var changes
   need a redeploy to take effect).
2. Open `/admin`, log in with OTP, add a zone (or edit the seeded one),
   turn on Instant Delivery for it, and add stock in **Daily Inventory** for
   today's date.
3. Open `/customer` on your phone, log in, set your address (capture GPS in
   Profile so you land in that zone), subscribe to milk with a test Razorpay
   payment (use [Razorpay's test card numbers](https://razorpay.com/docs/payments/payments/test-card-details/)
   in test mode), and place an Instant Delivery order.
4. Open `/partner`, log in with a different phone number, set your active
   zone to the one you just configured, and you should see the instant
   order (subscription orders only appear after the daily cron runs, or
   trigger it manually per step 6) — mark it Delivered and check that it
   shows up correctly back on the Admin dashboard.

## 8. Custom domain (optional)

**Vercel → your project → Settings → Domains** → add your domain and follow
the DNS instructions from your registrar. HTTPS is automatic.

---

## Security notes

- Every secret (`SUPABASE_SERVICE_ROLE_KEY`, `MSG91_AUTH_KEY`,
  `RAZORPAY_KEY_SECRET`, `APP_SESSION_SECRET`, `CRON_SECRET`) lives only in
  Vercel's environment variables and is read via `process.env` inside `/api`
  functions — none of it is ever sent to a browser.
- Razorpay payments are checked twice server-side: the HMAC signature
  (proves the order/payment pair is genuine) **and** a fetch back to
  Razorpay to confirm the amount actually paid matches the charge and that
  it was captured — this closes a gap where a valid-but-wrong-amount
  payment could otherwise be replayed against a bigger charge.
- `ADMIN_PHONES` is a simple allowlist checked on every OTP send/verify for
  the admin role. Good enough for a small founding team; if you add more
  admins later with different permission levels, that's a bigger change.

## Known simplifications (fine for a pilot, revisit before scaling)

- Partner payout is a flat rate, not a real commission model (see above).
- Zone capacity (subscribers vs. partners) is still a manual admin judgment
  call, per §5.4 of the spec — nothing auto-flags an overloaded zone.
- Route sorting is straight-line distance from the zone hub, not real
  road-network routing, per §8 of the spec.
- The placeholder app icons in `/icons` are a simple generated leaf mark —
  swap them for real brand art before a public launch.
- Vegetables/Groceries/Organic are still locked "Soon" tiles with no backing
  data, per §8 of the spec — building them out means repeating the Milk
  pattern (product rows, inventory rows, a themed hero video) rather than
  inventing a new one.
- WhatsApp broadcast is still simulated (§8) — `api/admin/[...resource].js`'s
  `broadcast` action just confirms the request, it doesn't call the WhatsApp
  Business API yet.
