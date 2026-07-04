export const UNPAID_LEAD_NUDGE_THRESHOLD_HOURS = 3;

export function unpaidLeadCutoffDate(now = new Date()): Date {
  return new Date(now.getTime() - UNPAID_LEAD_NUDGE_THRESHOLD_HOURS * 60 * 60 * 1000);
}

export function buildUnpaidLeadNudgeMessage(input: {
  firstName: string;
  tripName: string;
  departure: string;
}): string {
  return `Hi ${input.firstName}, Zahra here from Seek the Thrill. You registered for ${input.tripName} (${input.departure}), but your spot is confirmed only after the advance. Want me to help with the payment details?`;
}

// Stub for later WhatsApp BSP automation (Wati/AiSensy/Interakt).
// V1 is intentionally manual: admins use wa.me links from the CMS view.
export async function sendUnpaidLeadNudgeViaBspStub(_registrationId: number): Promise<void> {
  throw new Error('WhatsApp BSP automation is not implemented yet.');
}
