import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms — Seek the Thrill" }] }),
  component: () => (
    <>
    <BackButton />
    <section className="bg-[color:var(--gray-soft)] py-16">
      <div className="mx-auto max-w-3xl space-y-8 px-4 text-[color:var(--navy)]/85">
        <h1 className="font-display text-5xl">Terms & Conditions</h1>
        <p className="text-[color:var(--muted-foreground)]">Last updated: June 2026</p>
        {[
          ["Booking & registration", "All bookings happen via the website. A booking is confirmed once the advance is paid and we've verified it (within 24 hours)."],
          ["Payment terms", "Advance: ₹3,000 (non-refundable). Balance: due 15 days before trip start."],
          ["Cancellation policy", "30+ days: full minus ₹500. 15–29 days: 50%. 7–14 days: 25%. Under 7 days: no refund."],
          ["Traveller responsibilities", "You're responsible for valid ID, fitness for the trip, and following local laws."],
          ["Health & safety", "Inform us of medical conditions before booking. We carry a first-aid kit but you carry your own meds."],
          ["Limitation of liability", "We make every effort to keep things safe, but cannot be held liable for natural events, road closures, or personal injury due to negligence."],
          ["Contact", "zahra@seekthethrill.in"],
        ].map(([h, b]) => (
          <div key={h}>
            <h2 className="font-display text-2xl">{h}</h2>
            <p className="mt-2">{b}</p>
          </div>
        ))}
      </div>
    </section>
    </>
  ),
});