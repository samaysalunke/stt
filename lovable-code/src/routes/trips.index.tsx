import { createFileRoute } from "@tanstack/react-router";
import { trips } from "@/lib/trips";
import { TripCard } from "@/components/trip-card";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/trips/")({
  head: () => ({
    meta: [
      { title: "Upcoming trips — Seek the Thrill" },
      { name: "description", content: "Small groups. Handpicked routes across India. A few spots left on each." },
      { property: "og:title", content: "Upcoming trips — Seek the Thrill" },
      { property: "og:description", content: "Small groups. Handpicked routes across India." },
    ],
  }),
  component: TripsPage,
});

function TripsPage() {
  const sorted = [...trips].sort((a, b) => (a.status === "sold_out" ? 1 : 0) - (b.status === "sold_out" ? 1 : 0));
  return (
    <>
      <BackButton />
      <section className="bg-[color:var(--blush)] py-10">
        <div className="mx-auto max-w-5xl px-4 text-center">
          <h1 className="font-display text-4xl lg:text-6xl">Upcoming trips</h1>
          <p className="mx-auto mt-3 max-w-xl text-[color:var(--muted-foreground)]">
            Small groups. Handpicked routes across India.
          </p>
        </div>
      </section>
      <section className="bg-[color:var(--gray-soft)] py-10">
        <div className="mx-auto max-w-6xl px-4">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-[color:var(--muted-foreground)]">
              Nothing open right now. The next trip will show up here when it's ready.
            </p>
          ) : (
            <div className="grid gap-8 md:grid-cols-2">
              {sorted.map((t) => <TripCard key={t.slug} trip={t} />)}
            </div>
          )}
        </div>
      </section>
    </>
  );
}