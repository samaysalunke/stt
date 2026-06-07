import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import type { Trip } from "@/lib/trips";

export function TripCard({ trip }: { trip: Trip }) {
  const first = trip.batches[0];
  const remaining = first ? first.totalSpots - first.bookedSpots : 0;
  const soldOut = trip.status === "sold_out";

  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_4px_30px_-12px_rgba(27,43,58,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-18px_rgba(27,43,58,0.3)]">
      <Link to="/trips/$slug" params={{ slug: trip.slug }} className="relative block aspect-[4/3] overflow-hidden">
        <img
          src={trip.coverImage}
          alt={trip.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        {/* Duration pill — top-left */}
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white backdrop-blur-sm">
          {trip.duration}
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to="/trips/$slug" params={{ slug: trip.slug }}>
              <h3 className="font-display text-2xl leading-tight transition-colors group-hover:text-[color:var(--coral)]">
                {trip.title}
              </h3>
            </Link>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[color:var(--muted-foreground)]">
              <MapPin className="h-4 w-4 text-[color:var(--coral)]" />
              {trip.location}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-display text-2xl text-[color:var(--coral)] leading-none">
              ₹{first ? first.price.toLocaleString("en-IN") : "—"}
            </p>
            <p className="mt-1.5 text-xs text-[color:var(--muted-foreground)]">per person</p>
          </div>
        </div>

        {soldOut ? (
          <span className="mt-auto inline-flex cursor-not-allowed items-center justify-center rounded-full bg-gray-200 px-6 py-4 text-base font-medium text-gray-500">
            Sold out
          </span>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            <Link
              to="/trips/$slug"
              params={{ slug: trip.slug }}
              className="inline-flex items-center justify-center rounded-full px-6 py-4 font-display text-base font-medium text-white shadow-[0_18px_40px_-12px_color-mix(in_oklab,var(--coral)_70%,transparent)] transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: "var(--coral)" }}
            >
              View Details
            </Link>
            {first && (
              <p className="text-center text-xs text-[color:var(--muted-foreground)]">
                {remaining} slots left
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}