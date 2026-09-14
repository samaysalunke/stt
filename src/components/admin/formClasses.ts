/**
 * Shared class strings for admin form controls.
 *
 * Replaces `src/lib/adminStyles.ts`, which exported the same four rules as raw
 * inline-style strings. Those were pure presentation living under `src/lib/**`,
 * which the UI refresh treats as do-not-touch application code — so the rules
 * moved here rather than being edited in place.
 *
 * Every class below is the exact utility equivalent of the declaration it
 * replaces (arbitrary values where a named utility would also set line-height),
 * so the swap is invisible.
 *
 * The `-CONTENT-` pair also absorbs the two `inputCls` / `labelCls` constants
 * that were copy-pasted identically into all five content-editing pages.
 */

/** Registration forms: bordered control on the page surface. */
export const ADMIN_REG_INPUT_CLASS =
  'w-full py-2 px-3 border border-border rounded-lg text-sm font-sans box-border';

/** Registration forms: small caps field label. */
export const ADMIN_REG_LABEL_CLASS =
  'block text-xs font-bold text-gray-text mt-0 mx-0 mb-1 uppercase tracking-wide';

/** Content editors (settings, FAQs, testimonials): pill control on white. */
export const ADMIN_CONTENT_INPUT_CLASS =
  'w-full rounded-2xl px-4 py-3 text-sm outline-none border border-peach/80 bg-white';

/** Content editors: small caps field label. */
export const ADMIN_CONTENT_LABEL_CLASS =
  'block text-xs font-semibold uppercase tracking-widest mb-1.5 text-navy';
