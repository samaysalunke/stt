/**
 * Booking facts stated in more than one public place.
 *
 * The refund windows lived only inside cancellation.astro's markup. llms.txt
 * has to state the same policy in prose, and a second hand-written copy of a
 * refund schedule is a copy that will eventually disagree with the first — on a
 * page a traveller may have relied on. One array, two renderings.
 *
 * Admin copy in `settings.cancellationPolicy` still overrides the whole page;
 * when it is set, that override is the policy and this table is not shown.
 */
export interface RefundWindow {
  period: string;
  label: string;
  refund: string;
  detail: string;
  tone: 'positive' | 'partial' | 'none';
}

export const REFUND_WINDOWS: readonly RefundWindow[] = [
  { period: '30+ days', label: 'Before departure', refund: 'Full refund', detail: 'Minus a ₹500 processing fee', tone: 'positive' },
  { period: '15–29 days', label: 'Before departure', refund: '50% refund', detail: 'Of the eligible amount paid', tone: 'positive' },
  { period: '7–14 days', label: 'Before departure', refund: '25% refund', detail: 'Of the eligible amount paid', tone: 'partial' },
  { period: 'Under 7 days', label: 'Before departure', refund: 'No refund', detail: 'The booking is non-refundable', tone: 'none' },
];

/**
 * Typical group size. The homepage stat, llms.txt, the About description and
 * the organization schema all read this; the group-size FAQ
 * (`faqs/what-s-the-group-size.yaml`) states the same range in prose and has to
 * be kept in step by hand, since FAQ copy is admin-editable content.
 */
export const GROUP_SIZE = '8–15';

/**
 * What the company is, in one sentence a reader with no context can use. The
 * About page's own copy is a founder's letter and never says it; this is the
 * line the organization schema and the About meta description carry instead.
 */
export const ORG_DESCRIPTION =
  `Seek the Thrill is an India-based travel company founded by Zahra Shakir that runs small-group trips of ${GROUP_SIZE} travellers on offbeat routes across India.`;
