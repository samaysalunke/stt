import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { z } from "zod";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/thank-you")({
  validateSearch: z.object({ trip: z.string().optional() }),
  head: () => ({ meta: [{ title: "You're in — Seek the Thrill" }] }),
  component: ThankYou,
});

function ThankYou() {
  const { trip } = Route.useSearch();
  const items = [
    "Booking confirmation within 24 hours",
    "Trip prep guide sent to your email",
    "You'll be added to the trip WhatsApp group",
    "Balance payment reminder 15 days before the trip",
  ];
  return (
    <>
    <BackButton fallback="/" />
    <section className="bg-[color:var(--blush)] py-24 min-h-[80vh]">
      <div className="mx-auto max-w-2xl px-4 text-center">
        <div className="mx-auto mb-8 grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-white shadow-lg">
          <Check className="h-10 w-10" strokeWidth={3} />
        </div>
        <h1 className="font-display text-5xl lg:text-6xl">You're in.</h1>
        <p className="mt-4 text-[color:var(--muted-foreground)]">
          We've received your registration{trip ? ` for ${trip}` : ""}. We'll verify your payment and send confirmation within 24 hours.
        </p>
        <div className="mt-10 rounded-2xl bg-white p-8 text-left">
          <p className="mb-5 font-display text-xl">What happens next</p>
          <ul className="space-y-3">
            {items.map((i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-[color:var(--coral)] text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {i}
              </li>
            ))}
          </ul>
        </div>
        <Link to="/trips" className="btn-coral mt-10 inline-flex">See other trips →</Link>
      </div>
    </section>
    </>
  );
}