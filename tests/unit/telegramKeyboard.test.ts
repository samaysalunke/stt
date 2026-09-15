import { describe, it, expect } from 'vitest';
import { callbackData, keyboardFor, parseCallbackData } from '../../src/lib/telegramKeyboard';

const texts = (kb: { inline_keyboard: Array<Array<{ text: string }>> }) =>
  kb.inline_keyboard.flat().map((b) => b.text);
const datas = (kb: { inline_keyboard: Array<Array<{ callback_data?: string }>> }) =>
  kb.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean) as string[];

describe('parseCallbackData', () => {
  it('round-trips what callbackData builds', () => {
    expect(parseCallbackData(callbackData(4821, 'cf', 'advance_paid')))
      .toEqual({ regId: 4821, verb: 'cf', arg: 'advance_paid' });
    expect(parseCallbackData(callbackData(7, 'm', 'root')))
      .toEqual({ regId: 7, verb: 'm', arg: 'root' });
  });

  /**
   * callback_data is echoed back by the *client*, so a modified client can send
   * anything for a message it can see. Parsing must never be mistaken for
   * authorization — but it should still refuse obvious junk rather than pass it
   * on to the change functions.
   */
  it('rejects anything malformed, foreign, or out of range', () => {
    for (const bad of [
      undefined, null, '', 'b:1:cf', 'b:1:cf:x:y', 'x:1:cf:advance_paid',
      'b:0:cf:advance_paid', 'b:-3:cf:advance_paid', 'b:abc:cf:advance_paid',
      'b:1:drop:advance_paid', "b:1:cf:'; DROP TABLE registrations--",
    ]) {
      expect(parseCallbackData(bad), String(bad)).toBeNull();
    }
  });

  it('stays inside Telegram 64-byte callback_data limit', () => {
    const longest = callbackData(999999999, 'cx', 'partial_refund');
    expect(Buffer.byteLength(longest, 'utf8')).toBeLessThanOrEqual(64);
  });
});

describe('keyboardFor', () => {
  it('offers a pending booking the moves the transition guards actually allow', () => {
    const kb = keyboardFor({ regId: 1, status: 'pending', tripSlug: 'ladakh', totalAmount: 25000 });
    expect(texts(kb)).toEqual(['Confirm ▸', 'Cancel ▸', 'Open in admin ↗']);
  });

  /**
   * `needsConfirmPayment` refuses without a trip price, so offering Confirm on a
   * row that has none would be a button that can only ever error.
   */
  it('withholds Confirm from a booking with no trip price', () => {
    expect(texts(keyboardFor({ regId: 1, status: 'pending', totalAmount: null })))
      .toEqual(['Cancel ▸', 'Open in admin ↗']);
  });

  /**
   * A lead is still a conversation and a confirmed booking is already settled.
   * Neither gets a one-tap move, however much the guards would allow: the group
   * reads those messages, and acts on them in the admin UI.
   */
  it('gives a lead nothing but the way out to the admin UI', () => {
    for (const ctx of [
      { regId: 1, status: 'lead', tripSlug: 'ladakh', totalAmount: 25000 },
      { regId: 1, status: 'lead', totalAmount: null },
      { regId: 1, status: 'lead', amountPaid: 5000, totalAmount: 25000 },
    ]) {
      expect(texts(keyboardFor(ctx)), JSON.stringify(ctx)).toEqual(['Open in admin ↗']);
    }
  });

  it('gives a confirmed booking nothing but the way out to the admin UI', () => {
    // Including the outstanding balance: recording it is an admin-UI move now.
    expect(texts(keyboardFor({ regId: 1, status: 'confirmed', totalAmount: 25000, amountPaid: 5000 })))
      .toEqual(['Open in admin ↗']);
    expect(texts(keyboardFor({ regId: 1, status: 'confirmed', totalAmount: 25000, amountPaid: 25000 })))
      .toEqual(['Open in admin ↗']);
  });

  it('leaves a terminal booking nothing but the way out to the admin UI', () => {
    // `cancelled → lead` and `cancelled → pending` exist in TRANSITIONS but
    // refuse unconditionally; only Confirm re-instates, and that needs the
    // payment submenu, so the group gets the admin link instead.
    expect(texts(keyboardFor({ regId: 1, status: 'cancelled', totalAmount: 25000 })))
      .toEqual(['Confirm ▸', 'Open in admin ↗']);
    expect(texts(keyboardFor({ regId: 1, status: 'cancelled', totalAmount: null })))
      .toEqual(['Open in admin ↗']);
  });

  it('asks which payment was received before confirming', () => {
    const kb = keyboardFor({ regId: 9, status: 'pending' }, 'confirm');
    expect(texts(kb)).toEqual(['Advance paid', 'Fully paid', '← Back']);
    expect(datas(kb)).toEqual(['b:9:cf:advance_paid', 'b:9:cf:fully_paid', 'b:9:m:root']);
  });

  /** Partial refunds need an amount, which no button can carry — admin UI only. */
  it('offers only the two refund outcomes a button can express', () => {
    const kb = keyboardFor({ regId: 9, status: 'confirmed' }, 'cancel');
    expect(datas(kb)).toEqual(['b:9:cx:no_refund', 'b:9:cx:full_refund', 'b:9:m:root']);
    expect(texts(kb).join(' ')).not.toMatch(/partial/i);
  });

  it('every button it emits parses back to a usable action', () => {
    for (const status of ['wishlist', 'lead', 'pending', 'confirmed', 'cancelled', 'rejected']) {
      for (const menu of ['root', 'confirm', 'cancel'] as const) {
        for (const data of datas(keyboardFor({ regId: 42, status }, menu))) {
          expect(parseCallbackData(data), `${status}/${menu}/${data}`).not.toBeNull();
        }
      }
    }
  });
});
