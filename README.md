# Spillway Car Wash

Point-of-sale and operations app for Spillway Car Wash & Grill (Ibex Hill, Lusaka). Next.js 15, Firebase (Auth + Firestore, offline-first), Genkit plate scanning, installable PWA.

## What it does

**Attendants**
- Check in a car: plate lookup (or AI plate scan), new-car registration with photo, make/model, owner, phone and WhatsApp-receipt consent, services and optional bay number. Works offline.
- Loyalty badge at check-in: the customer's tier, points and visits.
- Cars On Site: complete a wash, assign washers, split payment across Cash, Mobile Money and Corporate Account; cancel a car that left.
- Receipt: sent automatically from the business WhatsApp number when the customer agreed and the WhatsApp API is set up, otherwise opened in WhatsApp on the tablet.
- My Shift: the payments you took and the cash you should be holding, by day, week or month.

**Admins**
- Dashboard, Daily Cash Up (count and close the drawer), Corporate accounts and settlements.
- Reports: monthly revenue, cars and average ticket vs last month, daily revenue, 12-month trend, busy hours, weekdays, services, attendants, washers, repeat customers; CSV export.
- Expenses & Banking: record expenses by category and source, record bank deposits, see revenue less expenses and cash still to bank; CSV export.
- Customers: loyalty list with tiers (1 point per car washed; Bronze, Silver 5+, Gold 15+, Platinum 30+ points), search, lapsed customers, CSV export, one-tap WhatsApp.
- Services, Users, Washers.

## Getting started

```sh
npm install
npm run dev   # http://localhost:9002
```

Firebase config is in `src/firebase/config.ts`. Set `GEMINI_API_KEY` to enable plate scanning.

## Optional: automatic WhatsApp receipts

Set these server environment variables (Vercel → Project → Settings → Environment Variables):

| Variable | |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | From Meta WhatsApp Cloud API |
| `WHATSAPP_ACCESS_TOKEN` | Permanent system-user token |
| `WHATSAPP_RECEIPT_TEMPLATE` | Optional approved template (body params: receipt id, date, plate, total) for customers outside the 24-hour window |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Optional, default `en_US` |
| `NEXT_PUBLIC_SUPPORT_PHONE` | Optional, printed on receipts for suggestions/complaints |

Without them the app keeps using the "open WhatsApp" button.

## Firestore

Deploy the rules after pulling this version — they add `customers`, `expenses` and `bankDeposits`, and let attendants fill in a car's contact details:

```sh
firebase deploy --only firestore:rules
```

## Checks

```sh
npm run typecheck
npm run build
```
