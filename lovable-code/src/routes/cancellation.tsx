import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/cancellation")({
  head: () => ({ meta: [{ title: "Cancellation policy — Seek the Thrill" }] }),
  component: () => (
    <>
    <BackButton />
    <section className="bg-[color:var(--gray-soft)] py-16">
      <div className="mx-auto max-w-3xl space-y-8 px-4 text-[color:var(--navy)]/85">
        <h1 className="font-display text-5xl">Cancellation policy</h1>
        <p>Things happen. Here's how refunds work.</p>
        <div className="overflow-hidden rounded-2xl border border-[color:var(--peach)] bg-white">
          {[
            ["30+ days before trip", "Full refund minus ₹500 processing"],
            ["15–29 days before trip", "50% refund"],
            ["7–14 days before trip", "25% refund"],
            ["Under 7 days before trip", "No refund (you can transfer the spot)"],
          ].map(([w, r]) => (
            <div key={w} className="flex items-center justify-between border-b border-[color:var(--peach)] px-4 py-4 last:border-b-0">
              <span>{w}</span>
              <span className="font-medium text-[color:var(--coral)]">{r}</span>
            </div>
          ))}
        </div>
        <p>To cancel, email <a className="underline" href="mailto:zahra@seekthethrill.in">zahra@seekthethrill.in</a>. Refunds processed within 7 working days.</p>
      </div>
    </section>
    </>
  ),
});