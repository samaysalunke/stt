import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import zahra from "@/assets/zahra.jpg";
import { ArrowLeft, Share2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Our story — Seek the Thrill" },
      { name: "description", content: "I'm Zahra. I built Seek the Thrill from one scary yes." },
      { property: "og:title", content: "Our story — Seek the Thrill" },
      { property: "og:description", content: "I'm Zahra. I built Seek the Thrill from one scary yes." },
    ],
  }),
  component: About,
});

function About() {
  const router = useRouter();
  const handleBack = (e: React.MouseEvent) => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.history.back();
    }
  };

  const principles = [
    {
      n: "01",
      t: "Real People",
      d: "No professional guides. Just local legends who know the land better than any map.",
    },
    {
      n: "02",
      t: "Hidden Spots",
      d: "We go where the big buses can't fit. Private trails and secret stays are our specialty.",
    },
    {
      n: "03",
      t: "Zero Fluff",
      d: "No forced stopping spots. No generic itineraries. Just raw, unfiltered adventure.",
    },
  ];

  return (
    <main className="bg-[color:var(--blush)] min-h-screen">
      {/* Top bar */}
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-5">
        <Link
          to="/"
          onClick={handleBack}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--navy)] hover:bg-white/70"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--navy)]/55">
          by <span className="font-display italic text-[color:var(--coral)] normal-case tracking-normal">Zahra</span>
        </span>
        <button
          aria-label="Share"
          className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--navy)] hover:bg-white/70"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </header>

      {/* Portrait + caption card */}
      <section className="mx-auto mt-6 max-w-2xl px-5">
        <div className="relative">
          <img
            src={zahra}
            alt="Zahra"
            className="aspect-[4/5] w-full rounded-sm object-cover"
          />
          <div className="absolute -bottom-6 left-1/2 w-[88%] -translate-x-1/2 rounded-md bg-white px-5 py-4 text-center shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]">
            <p className="font-display text-xl leading-snug text-[color:var(--navy)]">
              The Tour Industry is Broken.
            </p>
          </div>
        </div>
      </section>

      {/* Pull quote */}
      <section className="mx-auto max-w-2xl px-8 pt-16 pb-6">
        <blockquote className="font-display text-[1.35rem] italic leading-snug text-[color:var(--navy)]">
          "I spent years watching people travel thousands of miles just to see the same gift shops and eat at the same 'tourist-friendly' buffets."
        </blockquote>
      </section>

      {/* Body paragraphs */}
      <section className="mx-auto max-w-2xl space-y-5 px-8 pb-12 text-[15px] leading-relaxed text-[color:var(--navy)]/85">
        <p>
          I started <span className="font-medium text-[color:var(--coral)]">Offbeat</span> because I was tired of the fluff. I wanted the dust of the mountain roads, the taste of a home-cooked meal in a village that isn't on Google Maps, and the silence of a valley at dawn.
        </p>
        <p>
          Travel should change you. It shouldn't just be a checklist of monuments. It should be about the people you meet and the stories that don't make it to the brochure.
        </p>
      </section>

      {/* Dark principles block */}
      <section className="bg-[color:var(--navy)] text-white">
        <div className="mx-auto max-w-2xl px-8 py-14">
          <h2 className="text-center font-display text-3xl leading-tight">
            How we do it<br />differently
          </h2>
          <div className="mt-10 space-y-9 text-center">
            {principles.map((p) => (
              <div key={p.n}>
                <p className="font-display text-3xl italic text-[color:var(--coral)]">
                  {p.n}.
                </p>
                <p className="mt-2 font-display text-lg text-white">{p.t}</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/65">
                  {p.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Signature */}
      <section className="mx-auto max-w-2xl px-8 py-14 text-center">
        <p className="text-[15px] leading-relaxed text-[color:var(--navy)]/80">
          If you're looking for a holiday, there are plenty of apps for that. If you're looking for a journey that sticks to your soul, come with us.
        </p>
        <p className="mt-10 text-[10px] uppercase tracking-[0.3em] text-[color:var(--navy)]/55">
          With love &amp; grit,
        </p>
        <p className="mt-3 font-display text-5xl italic text-[color:var(--coral)]">
          Zahra
        </p>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-2xl px-5 pb-12">
        <Link
          to="/trips"
          className="flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-medium text-white shadow-[0_10px_30px_-12px_rgba(231,111,81,0.6)]"
          style={{ background: "var(--coral)" }}
        >
          Explore Zahra's Trips <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </main>
  );
}