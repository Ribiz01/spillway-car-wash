import { NextRequest, NextResponse } from 'next/server';
import { firebaseConfig } from '@/firebase/config';

/**
 * Sends a wash receipt from the business WhatsApp number (WhatsApp Cloud API).
 *
 * Optional: without WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN it
 * answers 503 and the app falls back to opening WhatsApp on the tablet.
 *
 * The caller's Firebase ID token is used for every read, so Firestore rules
 * still decide what this route can see — it has no admin access of its own.
 */
export const dynamic = 'force-dynamic';

type Value = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  mapValue?: { fields?: Fields };
  arrayValue?: { values?: Value[] };
};
type Fields = Record<string, Value>;

const str = (f: Fields | undefined, k: string) => f?.[k]?.stringValue ?? '';
const num = (f: Fields | undefined, k: string) =>
  Number(f?.[k]?.integerValue ?? f?.[k]?.doubleValue ?? 0);
const money = (n: number) => `K${n.toFixed(2)}`;

function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('260') && d.length >= 12) return d;
  if (d.startsWith('0') && d.length === 10) return `260${d.slice(1)}`;
  if (d.length === 9) return `260${d}`;
  return d;
}

export async function POST(request: NextRequest) {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp sending is not set up on the server.' }, { status: 503 });
    }

    const idToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const { transactionId } = await request.json().catch(() => ({}));
    if (!idToken || typeof transactionId !== 'string' || !transactionId.trim()) {
      return NextResponse.json({ error: 'Sign-in and transactionId are required.' }, { status: 400 });
    }

    const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
    const auth = { headers: { Authorization: `Bearer ${idToken}` } };

    const txRes = await fetch(`${base}/transactions/${encodeURIComponent(transactionId)}`, auth);
    if (txRes.status === 401 || txRes.status === 403) {
      return NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 });
    }
    if (!txRes.ok) return NextResponse.json({ error: 'Wash not found.' }, { status: 404 });
    const tx = ((await txRes.json()).fields ?? {}) as Fields;

    const status = str(tx, 'status');
    if (status !== 'Completed' && status !== 'Pending Payment') {
      return NextResponse.json({ error: 'Only paid washes get a receipt.' }, { status: 400 });
    }

    const plate = str(tx, 'licensePlate');
    const vRes = await fetch(`${base}/vehicles/${encodeURIComponent(plate)}`, auth);
    const vehicle = vRes.ok ? (((await vRes.json()).fields ?? {}) as Fields) : {};
    const phone = normalizePhone(str(vehicle, 'phoneNumber'));
    if (phone.length < 12) {
      return NextResponse.json({ error: 'No valid phone number saved for this car.' }, { status: 400 });
    }
    if (vehicle.whatsappReceiptConsent?.booleanValue !== true) {
      return NextResponse.json({ error: 'The customer has not agreed to WhatsApp receipts.' }, { status: 400 });
    }

    const services = (tx.services?.arrayValue?.values ?? []).map((v) => {
      const f = v.mapValue?.fields;
      return `- ${str(f, 'name')}: ${money(num(f, 'price'))}`;
    });
    const paymentValues = tx.payments?.arrayValue?.values ?? (tx.payment?.mapValue ? [tx.payment] : []);
    const payments = paymentValues.map((v) => {
      const f = v.mapValue?.fields;
      const ref = str(f, 'reference');
      return `- ${str(f, 'method')}: ${money(num(f, 'amount'))}${ref ? ` (${ref})` : ''}`;
    });
    const when = new Date(str(tx, 'completedAt') || str(tx, 'timestamp'));
    const date = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka', dateStyle: 'medium', timeStyle: 'short' });
    const vehicleLine = [str(tx, 'vehicleMake'), str(tx, 'vehicleModel')].filter(Boolean).join(' ');
    const total = money(num(tx, 'totalAmount'));
    const support = process.env.NEXT_PUBLIC_SUPPORT_PHONE;

    const body = [
      '*Spillway Car Wash & Grill*',
      '*OFFICIAL RECEIPT*',
      `Receipt: ${transactionId}`,
      `Date: ${date}`,
      `Plate: ${plate}${vehicleLine ? ` (${vehicleLine})` : ''}`,
      '',
      '*Services*',
      ...services,
      '',
      '*Payment*',
      ...payments,
      '',
      `*TOTAL: ${total}*`,
      ...(status === 'Pending Payment' ? ['Part of this wash is billed to your company account.'] : []),
      '',
      'Thank you for choosing Spillway!',
      ...(support ? [`Suggestions or complaints: ${support}`] : []),
    ].join('\n');

    // A pre-approved template is needed to message customers outside WhatsApp's
    // 24-hour window. Its body takes: receipt id, date, plate, total.
    const template = process.env.WHATSAPP_RECEIPT_TEMPLATE;
    const payload = template
      ? {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [transactionId, date, plate, total].map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }
      : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } };

    const version = process.env.WHATSAPP_API_VERSION || 'v22.0';
    const send = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await send.json().catch(() => ({}));
    if (!send.ok) {
      return NextResponse.json(
        { error: result?.error?.message || 'WhatsApp rejected the message.' },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, messageId: result?.messages?.[0]?.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Receipt delivery failed.' },
      { status: 500 }
    );
  }
}
