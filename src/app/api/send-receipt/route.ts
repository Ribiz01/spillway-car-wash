import { NextRequest, NextResponse } from 'next/server';
import { firebaseConfig } from '@/firebase/config';
import { normalisePhone } from '@/lib/loyalty';

export const dynamic = 'force-dynamic';

/**
 * Delivers a wash receipt over the WhatsApp Cloud API.
 *
 * The browser sends only a transaction id and the caller's Firebase ID token.
 * Everything in the message is read back from Firestore *as that user*, so the
 * client cannot make this endpoint text arbitrary numbers or invent a receipt:
 * the wash must exist, the caller must be allowed to read it and be the person
 * who handled it (or an admin), and the customer must have agreed to WhatsApp.
 */

type Value = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  mapValue?: { fields?: Fields };
  arrayValue?: { values?: Value[] };
};
type Fields = Record<string, Value>;

const str = (fields: Fields, key: string) => fields[key]?.stringValue ?? '';
const num = (fields: Fields, key: string) => Number(fields[key]?.integerValue ?? fields[key]?.doubleValue ?? 0);
const maps = (value: Value | undefined) => (value?.arrayValue?.values ?? []).map((v) => v.mapValue?.fields ?? {});
const money = (amount: number) => `ZMW ${amount.toFixed(2)}`;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const idToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const body = await request.json().catch(() => null);
    const transactionId = typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
    if (!idToken || !transactionId) return fail('Authentication and transactionId are required.', 400);

    // Resolve the token to a uid. A forged or expired token fails here.
    const accountResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
    );
    const account = await accountResponse.json();
    const uid: string | undefined = account.users?.[0]?.localId;
    if (!accountResponse.ok || !uid) return fail('Your session is invalid. Sign in again.', 401);

    const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
    const asUser = { headers: { Authorization: `Bearer ${idToken}` } };

    const transactionResponse = await fetch(`${base}/transactions/${encodeURIComponent(transactionId)}`, asUser);
    if (!transactionResponse.ok) return fail('Transaction was not found or is not accessible.', 404);
    const fields = ((await transactionResponse.json()).fields ?? {}) as Fields;

    // Whoever checked the car in or took the payment may send its receipt. Anyone else must be an admin.
    if (str(fields, 'userId') !== uid && str(fields, 'completedByUid') !== uid) {
      const profileResponse = await fetch(`${base}/users/${encodeURIComponent(uid)}`, asUser);
      const profile = profileResponse.ok ? await profileResponse.json() : null;
      if (profile?.fields?.role?.stringValue !== 'Admin') {
        return fail('You cannot send a receipt for this transaction.', 403);
      }
    }

    const status = str(fields, 'status');
    if (status !== 'Completed' && status !== 'Pending Payment') {
      return fail('Only a completed wash has a receipt.', 400);
    }

    const phoneNumber = normalisePhone(str(fields, 'customerPhone'));
    if (!phoneNumber) return fail('The customer has no valid saved phone number.', 400);
    if (fields.whatsappReceiptConsent?.booleanValue !== true) {
      return fail('Customer WhatsApp receipt consent was not recorded.', 400);
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) {
      return fail('WhatsApp delivery is not configured on the server.', 503);
    }

    const services = maps(fields.services).map((s) => `- ${str(s, 'name')}: ${money(num(s, 'price'))}`);
    // Split payments first; the single legacy `payment` field as a fallback.
    const paymentMaps = maps(fields.payments);
    const paymentFields = paymentMaps.length ? paymentMaps : fields.payment?.mapValue?.fields ? [fields.payment.mapValue.fields] : [];
    const payments = paymentFields.map((p) => {
      const reference = str(p, 'reference');
      return `- ${str(p, 'method')}: ${money(num(p, 'amount'))}${reference ? ` (${reference})` : ''}`;
    });
    const onAccount = paymentFields
      .filter((p) => str(p, 'method') === 'Corporate Account')
      .reduce((acc, p) => acc + num(p, 'amount'), 0);
    const total = num(fields, 'totalAmount');

    const vehicleName = [str(fields, 'vehicleMake'), str(fields, 'vehicleModel')].filter(Boolean).join(' ');
    const plate = str(fields, 'licensePlate');
    const vehicle = vehicleName ? `${vehicleName} (${plate})` : plate;
    const date = new Date(str(fields, 'completedAt') || str(fields, 'timestamp')).toLocaleString('en-ZM', {
      timeZone: 'Africa/Lusaka',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const methods = [...new Set(paymentFields.map((p) => str(p, 'method')))].join(' + ') || '—';

    const templateName = process.env.WHATSAPP_RECEIPT_TEMPLATE;
    const message = templateName
      ? {
          type: 'template',
          template: {
            name: templateName,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
            components: [
              {
                type: 'body',
                // Template parameters may not contain newlines, so lists are flattened.
                parameters: [
                  transactionId,
                  date,
                  vehicle,
                  services.map((s) => s.slice(2)).join(', '),
                  money(total),
                  money(total - onAccount),
                  money(onAccount),
                  methods,
                ].map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }
      : {
          type: 'text',
          text: {
            body: [
              '*Spillway Car Wash & Grill*',
              '*OFFICIAL RECEIPT*',
              '',
              `Receipt ID: ${transactionId}`,
              `Date: ${date}`,
              `Vehicle: ${vehicle}`,
              '',
              '*Services:*',
              ...services,
              '',
              '*Payment:*',
              ...payments,
              '',
              `*TOTAL: ${money(total)}*`,
              ...(onAccount > 0 ? [`On account (still owed): ${money(onAccount)}`] : []),
              '',
              'Thank you for your business!',
            ].join('\n'),
          },
        };

    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v22.0';
    const sendResponse = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        ...message,
      }),
    });
    const result = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok) {
      return fail(result.error?.message || 'WhatsApp rejected the receipt message.', 502);
    }
    return NextResponse.json({ success: true, messageId: result.messages?.[0]?.id });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Receipt delivery failed.', 500);
  }
}
