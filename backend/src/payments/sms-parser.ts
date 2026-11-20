export interface ParsedPaymentSms {
  amountMinor: bigint;
  txRef: string;
  /** Name the money was sent to, as printed in the SMS, upper-cased. */
  receiverName?: string;
}

export type SmsParseResult = { ok: true; value: ParsedPaymentSms } | { ok: false; reason: 'NO_AMOUNT' | 'NO_REFERENCE' };

/** "1,234.50" -> 123450n (santim). */
function toMinor(text: string): bigint {
  const [whole, frac = ''] = text.replace(/,/g, '').split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
}

/**
 * Reads the confirmation SMS a player received after sending money, e.g. Telebirr:
 *
 *   "Dear eyob You have transferred ETB 200.00 to YABIBAL ESHETE (2519****5847) on 20/11/2026 12:30:58.
 *    Your transaction number is DKK7FBK7EP. The service fee is ETB 1.74 ..."
 *
 * The parse only extracts what the player claims. Staff (or a later automatic receipt check) still confirm
 * the payment really arrived before any money is credited.
 */
export function parsePaymentSms(text: string): SmsParseResult {
  const sms = text.replace(/\s+/g, ' ').trim();

  const amount =
    /transferred\s+(?:ETB|Birr|Br)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(sms) ??
    /(?:sent|paid)\s+(?:ETB|Birr|Br)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(sms) ??
    /(?:ETB|Birr|Br)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(sms);
  if (!amount) return { ok: false, reason: 'NO_AMOUNT' };

  const ref =
    /transaction (?:number|id|no\.?) is\s*([A-Z0-9]{6,20})/i.exec(sms) ??
    /(?:txn|transaction|trans\.?)\s*(?:id|no\.?|number|ref)?\s*[:#]?\s*([A-Z0-9]{8,20})/i.exec(sms) ??
    /receipt\/([A-Z0-9]{6,20})/i.exec(sms);
  if (!ref) return { ok: false, reason: 'NO_REFERENCE' };

  const receiver = /\bto\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s*\(/.exec(sms);
  return {
    ok: true,
    value: {
      amountMinor: toMinor(amount[1]),
      txRef: ref[1].toUpperCase(),
      receiverName: receiver ? receiver[1].trim().toUpperCase() : undefined,
    },
  };
}
