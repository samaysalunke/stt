import { getDb } from './db';
import { departureGroupLink } from './trips';

/**
 * The WhatsApp group link to put in a confirmation email, stamping the
 * registration as sent so the departure's "send group link" banner stops
 * counting it. Stamped when the email is built rather than once it is
 * delivered: a failed send is in the email log, and the cost of a miss is one
 * traveller asking for the link, not a duplicate mail to the whole group.
 */
export function claimGroupLink(reg: { id?: number | null; trip_slug?: string | null; trip_name?: string | null; batch_id?: string | null }): string | null {
  const link = departureGroupLink(reg);
  if (link && reg.id) {
    try {
      getDb().prepare('UPDATE registrations SET whatsapp_group_sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(reg.id);
    } catch (err) {
      console.error('[tripGroup] stamp failed', err);
    }
  }
  return link;
}
