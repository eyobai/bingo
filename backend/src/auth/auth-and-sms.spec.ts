import { parsePaymentSms } from '../payments/sms-parser';
import { signInitData, verifyInitData } from './telegram-init-data';

describe('verifyInitData', () => {
  const token = '123456:TEST-TOKEN';
  const now = 1_800_000_000;
  const fields = {
    auth_date: String(now - 60),
    query_id: 'AAE',
    user: JSON.stringify({ id: 42, first_name: 'Abebe', username: 'abebe' }),
    start_param: 'ref_ABC',
  };

  it('accepts data signed with the bot token', () => {
    const r = verifyInitData(signInitData(fields, token), token, 3600, now);
    expect(r).toMatchObject({ ok: true, user: { id: 42, first_name: 'Abebe' }, startParam: 'ref_ABC' });
  });

  it('rejects another bot token, edited fields and old data', () => {
    const signed = signInitData(fields, token);
    expect(verifyInitData(signed, '999:OTHER', 3600, now)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    const tampered = signed.replace('Abebe', 'Admin');
    expect(verifyInitData(tampered, token, 3600, now)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyInitData(signed, token, 30, now)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(verifyInitData('user=x', token, 30, now)).toEqual({ ok: false, reason: 'MISSING_HASH' });
  });
});

describe('parsePaymentSms', () => {
  it('reads a Telebirr transfer SMS', () => {
    const sms =
      'Dear eyob You have transferred ETB 200.00 to YABIBAL ESHETE (2519****5847) on 20/11/2026 12:30:58. ' +
      'Your transaction number is DKK7FBK7EP. The service fee is ETB 1.74 and 15% VAT on the service fee is ' +
      'ETB 0.26. Your current E-Money Account balance is ETB 895.94. To download your payment information ' +
      'please click this link: https://transactioninfo.ethiotelecom.et/receipt/DKK7FBK7EP. Thank you for using telebirr';
    expect(parsePaymentSms(sms)).toEqual({
      ok: true,
      value: { amountMinor: 20_000n, txRef: 'DKK7FBK7EP', receiverName: 'YABIBAL ESHETE' },
    });
  });

  it('handles thousands separators and refuses texts without an amount or reference', () => {
    const r = parsePaymentSms('You have transferred ETB 1,250.5 to A B (09) Your transaction number is ab12cd34ef');
    expect(r).toMatchObject({ ok: true, value: { amountMinor: 125_050n, txRef: 'AB12CD34EF' } });
    expect(parsePaymentSms('hello')).toEqual({ ok: false, reason: 'NO_AMOUNT' });
    expect(parsePaymentSms('You have transferred ETB 100 to X')).toEqual({ ok: false, reason: 'NO_REFERENCE' });
  });
});
