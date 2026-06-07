import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar } from "lucide-react";
import { albums } from "@/lib/albums";

export const Route = createFileRoute("/photo-vault")({
  head: () => ({
    meta: [
      { title: "The Vault — Seek the Thrill" },
      { name: "description", content: "Every memory, raw and unedited." },
      { property: "og:title", content: "The Vault — Seek the Thrill" },
      { property: "og:description", content: "Every memory, raw and unedited." },
    ],
  }),
  component: Vault,
});

const testimonials = [
  {
    quote: "The Ladakh pass was brutal and beautiful. Zahra's planning made it feel like a personal journey, not a tour.",
    name: "Arjun K.",
    avatar: "https://i.pravatar.cc/100?img=33",
  },
  {
    quote: "No fluff, just the road. Exactly what I needed to disconnect from the noise.",
    name: "Sarah M.",
    avatar: "https://i.pravatar.cc/100?img=47",
  },
];

function Vault() {
  return (
    <main className="bg-[color:var(--cream,#faf6f1)] min-h-screen">
      {/* Top app row */}
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-5">
        <Link to="/" className="flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded-md text-[11px] font-display text-white"
            style={{ background: "var(--coral)" }}
          >
            S
          </span>
          <span className="font-display text-sm tracking-tight text-[color:var(--navy)]">
            Seek the Thrill
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[color:var(--coral)] to-[color:var(--peach)] text-xs font-medium text-white"
          >
            Z
          </span>
        </div>
      </header>

      {/* Title block */}
      <section className="mx-auto max-w-2xl px-5 pt-10 pb-6">
        <h1 className="font-display text-[2.75rem] leading-[1.05] text-[color:var(--navy)]">
          The Vault
        </h1>
        <p className="mt-2 font-display text-base italic text-[color:var(--navy)]/55">
          Every memory, raw and unedited.
        </p>
      </section>

      {/* Album cards */}
      <section className="mx-auto max-w-2xl space-y-6 px-5 pb-16">
        {albums.map((a) => (
          <Link
            key={a.slug}
            to="/photo-vault/$album"
            params={{ album: a.slug }}
            className="group relative block overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]"
          >
            <div className="relative aspect-[5/6] overflow-hidden">
              <img
                src={a.cover}
                alt={a.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <span
                className="absolute left-4 top-4 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-white"
                style={{ background: "var(--coral)" }}
              >
                {a.days} Days
              </span>
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <h2 className="font-display text-3xl leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                  {a.title}
                </h2>
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                  {a.subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-6 py-4 text-xs text-[color:var(--navy)]/65">
              <Calendar className="h-3.5 w-3.5" />
              <span>{a.date}</span>
            </div>
          </Link>
        ))}
      </section>

      {/* Testimonials */}
      <section className="mx-auto max-w-2xl space-y-5 px-5 pb-16">
        {testimonials.map((t) => (
          <figure
            key={t.name}
            className="rounded-2xl border border-[color:var(--peach)]/70 bg-white p-6"
          >
            <span
              aria-hidden
              className="block font-display text-4xl leading-none text-[color:var(--coral)]/70"
            >
              "
            </span>
            <blockquote className="mt-1 font-display italic text-[color:var(--navy)]/85">
              "{t.quote}"
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <img src={t.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
              <span className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--navy)]/55">
                — {t.name}
              </span>
            </figcaption>
          </figure>
        ))}
      </section>

      {/* Footer signature */}
      <footer className="mx-auto max-w-2xl px-5 pb-12 text-center">
        <div className="inline-flex items-center gap-2">
          <span
            className="grid h-6 w-6 place-items-center rounded-md text-[10px] font-display text-white"
            style={{ background: "var(--coral)" }}
          >
            S
          </span>
          <span className="font-display text-sm text-[color:var(--navy)]">Seek the Thrill</span>
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-[color:var(--navy)]/45">
          Curated by Zahra © 2026
        </p>
      </footer>

    </main>
  );
}