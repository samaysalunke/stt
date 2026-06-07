import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Instagram, MapPin, Users } from "lucide-react";
import { motion } from "framer-motion";
import hero from "@/assets/hero-mountains.jpg";
import community from "@/assets/community.jpg";
import spiti from "@/assets/trip-spiti.jpg";
import meghalaya from "@/assets/trip-meghalaya.jpg";
import gokarna from "@/assets/trip-gokarna.jpg";
import ladakh from "@/assets/trip-ladakh.jpg";
import logoAsset from "@/assets/seek-the-thrill-logo.png.asset.json";
import { trips } from "@/lib/trips";
import { TripCard } from "@/components/trip-card";
import { HomeScrollHeader } from "@/components/home-scroll-header";
import { useState, type ReactNode } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seek the Thrill — Offbeat group trips across India" },
      { name: "description", content: "Small-group offbeat travel across India. Curated routes for solo travellers and friend groups. Run by Zahra." },
      { property: "og:title", content: "Seek the Thrill — Offbeat group trips across India" },
      { property: "og:description", content: "Small-group offbeat travel across India. Run by Zahra." },
    ],
  }),
  component: Index,
});

function Index() {
  const upcoming = trips.filter((t) => t.status !== "sold_out").slice(0, 3);
  return (
    <>
      <HomeScrollHeader />
      <Hero />
      <UpcomingSection trips={upcoming} />
      <HowItWorks />
      <Testimonials />
      <InstagramGrid />
      <Newsletter />
    </>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen w-full overflow-hidden">
      <img
        src={hero}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Bottom-only readability gradient — keeps the photo continuous from top */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, transparent 45%, color-mix(in oklab, var(--navy) 70%, transparent) 100%)",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center px-4 pt-8 pb-6 text-center text-white sm:max-w-lg">
        {/* Brand mark */}
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="flex flex-col items-center"
        >
          <div className="relative">
            <div className="absolute inset-0 -z-10 rounded-3xl blur-2xl" style={{ background: "color-mix(in oklab, var(--coral) 55%, transparent)" }} />
            <img
              src={logoAsset.url}
              alt="Seek the Thrill logo"
              className="h-24 w-24 rounded-3xl object-cover shadow-2xl ring-1 ring-white/15"
            />
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white">
            Seek the Thrill
          </h1>
          <p className="mt-1 font-display italic text-sm text-white/70">by Zahra Shakir</p>
        </motion.div>

        {/* Spacer that lets the mountains breathe */}
        <div className="flex-1 min-h-[80px]" />

        <motion.span
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--coral)]/70 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--coral)]"
        >
          <MapPin className="h-3.5 w-3.5" /> India's Offbeat Routes
        </motion.span>

        <motion.h2
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-5 font-display text-[clamp(2.4rem,9vw,3.5rem)] font-semibold leading-[1.02] text-white"
        >
          Go where the
          <br />
          <span className="italic text-[color:var(--coral)]">crowds don't.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
          className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/80"
        >
          Group trips for travellers. Offbeat spots, zero fluff.
        </motion.p>

        {/* Stats card */}
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.35 }}
          className="mt-5 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-4 backdrop-blur-md"
        >
          <div className="grid grid-cols-3 divide-x divide-white/15 text-center">
            <Stat value="12–16" label="Group Size" />
            <Stat value="10+" label="Destinations" />
            <Stat value={<>4.9<span className="text-[color:var(--coral)]">★</span></>} label="Avg Rating" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.45 }}
          className="mt-4 w-full"
        >
          <Link
            to="/trips"
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 font-display text-lg font-medium text-white shadow-[0_18px_40px_-12px_color-mix(in_oklab,var(--coral)_70%,transparent)] transition-transform hover:-translate-y-0.5"
            style={{ backgroundColor: "var(--coral)" }}
          >
            <Users className="h-5 w-5" /> Join a Trip
          </Link>
        </motion.div>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.55 }}
          className="mt-4 flex items-center justify-center gap-3"
        >
          <div className="flex -space-x-2">
            {[spiti, meghalaya, gokarna, ladakh].map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                className="h-8 w-8 rounded-full border-2 border-[color:var(--navy)] object-cover"
              />
            ))}
          </div>
          <p className="text-sm text-white/75">
            Joined by <span className="font-semibold text-white">340+</span> adventurers
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="px-2">
      <p className="font-display text-xl font-semibold text-[color:var(--coral)]">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">{label}</p>
    </div>
  );
}

function UpcomingSection({ trips }: { trips: typeof import("@/lib/trips").trips }) {
  return (
    <section className="bg-[color:var(--gray-soft)] pt-10 pb-16">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="whitespace-nowrap font-display text-[clamp(1.9rem,8vw,4rem)] leading-[1.05] tracking-tight">
          Where to, <span className="italic text-[color:var(--coral)]">wanderer?</span>
        </h2>
        <div className="mt-10 mb-8 flex items-end justify-between gap-6">
          <h3 className="font-display text-2xl text-[color:var(--navy)]">Featured Trips</h3>
          <Link to="/trips" className="text-sm font-medium text-[color:var(--coral)] hover:underline">
            See All →
          </Link>
        </div>
        <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((t) => <TripCard key={t.slug} trip={t} />)}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Pick a trip", d: "Browse upcoming destinations, find one that pulls you." },
    { n: "02", t: "Save your spot", d: "Pay a small advance. The rest follows later." },
    { n: "03", t: "Show up", d: "We handle the details. You handle the experience." },
  ];
  return (
    <section className="bg-[color:var(--navy)] py-20 text-white">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-10 max-w-2xl font-display text-4xl text-white lg:text-5xl">How it works</h2>
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-white/15 pt-6">
              <p className="font-display text-6xl text-white/15">{s.n}</p>
              <h3 className="mt-6 font-display text-2xl text-white">{s.t}</h3>
              <p className="mt-3 text-white/65">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const quotes = [
    { q: "I signed up alone, came back with seven people I now actually call.", n: "Aanya", t: "Spiti Valley · 2024" },
    { q: "It didn't feel like a 'tour'. It felt like a really good friend planned a trip and brought along nice people.", n: "Rohit", t: "Meghalaya · 2024" },
    { q: "Zahra runs these like she has something personal to prove. In a good way.", n: "Priya", t: "Ladakh · 2023" },
    { q: "The kind of trip that makes you a little annoying at parties for weeks after.", n: "Kabir", t: "Gokarna · 2024" },
  ];
  return (
    <section className="bg-[color:var(--blush)] py-20">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-10 max-w-2xl">
          <h2 className="font-display text-4xl lg:text-5xl">Who comes on these trips</h2>
          <p className="mt-4 text-[color:var(--muted-foreground)]">
            Solo travelers. Friend groups. People who said yes on a whim. Nobody's left out.
          </p>
        </div>
        <div className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quotes.map((q) => (
            <figure key={q.n} className="flex shrink-0 basis-[84%] snap-start flex-col gap-6 rounded-2xl bg-white p-7 shadow-sm sm:basis-[55%] lg:basis-[28%]">
              <blockquote className="font-display text-lg leading-snug text-[color:var(--navy)]">"{q.q}"</blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--coral)]/15 font-display text-[color:var(--coral)]">
                  {q.n[0]}
                </span>
                <div>
                  <p className="text-sm font-medium">{q.n}</p>
                  <p className="text-xs text-[color:var(--muted-foreground)]">{q.t}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstagramGrid() {
  const imgs = [spiti, meghalaya, gokarna, ladakh];
  return (
    <section className="bg-[color:var(--gray-soft)] py-20">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="font-display text-4xl lg:text-5xl">Straight from the trips</h2>
            <p className="mt-2 text-sm text-[color:var(--coral)]">@seekthethrill_</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {imgs.map((src, i) => (
            <a key={i} href="https://instagram.com/seekthethrill_" target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-xl">
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
              <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/40">
                <Instagram className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </a>
          ))}
        </div>
        <div className="mt-10 text-center">
          <a href="https://instagram.com/seekthethrill_" target="_blank" rel="noreferrer" className="btn-outline-coral">
            Follow the journey →
          </a>
        </div>
      </div>
    </section>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  return (
    <section className="relative overflow-hidden bg-[color:var(--blush)] py-16" style={{ backgroundImage: `url(${community})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="absolute inset-0 bg-[color:var(--navy)]/75" />
      <div className="relative mx-auto max-w-3xl px-4 text-center text-white">
        <h2 className="font-display text-4xl text-white lg:text-5xl">Be first to know</h2>
        <p className="mt-4 text-white/75">New trips, new batches, things worth knowing. No spam.</p>
        <div className="mt-8">
          {done ? (
            <p className="text-[color:var(--coral)]">You're in. We'll be in touch when something good is coming.</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) setDone(true); }} className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="flex-1 rounded-full bg-white/10 border border-white/25 px-5 py-3 text-white placeholder:text-white/50 focus:border-[color:var(--coral)] focus:outline-none" />
              <button type="submit" className="btn-coral">Keep me posted</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
