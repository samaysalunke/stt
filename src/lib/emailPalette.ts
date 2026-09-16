/* Brand colours for HTML email.
 *
 * Every other surface in this project reads `var(--color-*)` from
 * `src/styles/tokens.css`. Email cannot: Outlook, Gmail's web client and most
 * mobile clients strip custom properties, so the literal hex has to be inlined
 * on each element. That is why ~90 hexes accumulated across the mail templates
 * — and why the accessibility retunes made in tokens.css never reached them.
 * Every template here still shipped the pre-retune #6B7280 body grey.
 *
 * These constants are that same palette, written out. Keep them in sync with
 * tokens.css by hand; the values below carry the token name they mirror so a
 * grep for the token finds this file too.
 */

/* --color-navy */
export const NAVY = '#1B2B3A';
/* --color-gray-text. Was #6B7280, which fails AA on our tinted boxes. */
export const GRAY_TEXT = '#646B76';
/* --color-coral — FILL ONLY. White text on it is 3.0:1. */
export const CORAL = '#E8725A';
/* --color-cta — coral as a fill behind white text, 4.84:1. */
export const CTA = '#C6472A';
/* --color-coral-ink — coral as body-size text on a light surface, 5.04:1. */
export const CORAL_INK = '#B84E2B';
/* --color-blush */
export const BLUSH = '#FDF0EC';
/* --color-peach */
export const PEACH = '#F5DDD7';
/* --color-border */
export const BORDER = '#E8DDD9';
/* --color-success-surface-ink */
export const SUCCESS_INK = '#065F46';
/* --color-whatsapp — WhatsApp's own brand green, not ours to retune. */
export const WHATSAPP = '#25D366';
