import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Clock, Check, X, Users } from "lucide-react";
import { getTrip, type Batch, type Trip } from "@/lib/trips";
import { BackButton } from "@/components/back-button";
import { Breadcrumbs } from "@/components/breadcrumbs";

const tripPhotos = [
  "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=900&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=80",
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=80",
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=80",
  "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=900&q=80",
];

const tripTestimonials = [
  {
    name: "Rahul K.",
    batch: "June Batch, 2024",
    quote: "The best hidden spots I've ever seen. Spiti doesn't feel real — and STT made sure it stayed that way.",
    avatar: "https://i.pravatar.cc/100?img=12",
  },
  {
    name: "Nandita R.",
    batch: "August Batch, 2024",
    quote: "I came for the mountains. I left with a group of people I'll know for life. That's the STT thing.",
    avatar: "https://i.pravatar.cc/100?img=47",
  },
  {
    name: "Vikram S.",
    batch: "July Batch, 2024",
    quote: "No fluff, no tourist traps. Just real Spiti. The homestay family fed us like we were their own.",
    avatar: "https://i.pravatar.cc/100?img=33",
  },
];

export const Route = createFileRoute("/trips/$slug")({
  loader: ({ params }) => {
    const trip = getTrip(params.slug);
    if (!trip) throw notFound();
    return { trip };
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.trip
      ? [
          { title: `${loaderData.trip.title} — Seek the Thrill` },
          { name: "description", content: loaderData.trip.shortDescription },
          { property: "og:title", content: loaderData.trip.title },
          { property: "og:description", content: loaderData.trip.shortDescription },
          { property: "og:image", content: loaderData.trip.coverImage },
        ]
      : [],
  }),
  component: TripDetail,
});

function TripDetail() {
  const { trip } = Route.useLoaderData() as { trip: Trip };
  const [batchId, setBatchId] = useState(trip.batches[0]?.id);
  const selected = trip.batches.find((b) => b.id === batchId) ?? trip.batches[0];
  const soldOut = trip.status === "sold_out";
  const open = trip.registrationEnabled && !soldOut;

  const statusMap: Record<string, { label: string; bg: string } | null> = {
    upcoming: { label: "Upcoming", bg: "var(--coral)" },
    filling_fast: null,
    sold_out: { label: "Sold out", bg: "#6b7280" },
  };
  const status = statusMap[trip.status];

  return (
    <>
      <BackButton fallback="/trips" />
      {/* Hero */}
      <section className="relative h-[55vh] min-h-[420px] w-full overflow-hidden">
        <img src={trip.coverImage} alt={trip.title} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col items-start justify-end px-4 pb-10">
          <Breadcrumbs
            variant="light"
            className="mb-4"
            items={[
              { label: "Home", to: "/" },
              { label: "Trips", to: "/trips" },
              { label: trip.title },
            ]}
          />
          {status && (
            <span className="pill mb-3 text-white" style={{ background: status.bg }}>{status.label}</span>
          )}
          <h1 className="max-w-3xl font-display text-[clamp(2rem,5vw,4rem)] font-medium leading-tight" style={{ color: "var(--peach)" }}>{trip.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="pill bg-white/15 text-white backdrop-blur"><MapPin className="h-3.5 w-3.5" />{trip.location}</span>
            <span className="pill bg-white/15 text-white backdrop-blur"><Clock className="h-3.5 w-3.5" />{trip.duration}</span>
            <span className="pill text-white" style={{ background: "var(--coral)" }}>from ₹{trip.batches[0]?.price.toLocaleString("en-IN")} / person</span>
          </div>
        </div>
      </section>

      <section className="bg-[color:var(--gray-soft)] py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 lg:grid-cols-[1.6fr_1fr]">
          {/* Left */}
          <div className="space-y-10">
            <Block title="What this trip feels like">
              <p className="whitespace-pre-line text-lg leading-relaxed text-[color:var(--navy)]/85">{trip.longDescription}</p>
            </Block>

            <Block title="Things you'll probably talk about later">
              <ul className="grid gap-3 sm:grid-cols-2">
                {trip.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-3 text-[color:var(--navy)]/85">
                    <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-[color:var(--coral)] text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            </Block>

            <Block title="Photos">
              <p className="-mt-2 mb-4 text-sm text-[color:var(--muted-foreground)]">From the trail. No filters, no staging.</p>
              <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {tripPhotos.map((src: string, i: number) => (
                  <img
                    key={i}
                    src={src}
                    alt={`${trip.title} photo ${i + 1}`}
                    loading="lazy"
                    className="h-64 w-[78%] flex-none snap-start rounded-2xl object-cover sm:h-72 sm:w-[55%] md:w-[40%]"
                  />
                ))}
              </div>
            </Block>

            <Block title="What they said">
              <p className="-mt-2 mb-4 text-sm text-[color:var(--muted-foreground)]">Real words. Zero editing.</p>
              <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {tripTestimonials.map((t, i: number) => (
                  <figure
                    key={i}
                    className="relative flex w-[85%] flex-none snap-start flex-col justify-between rounded-2xl bg-[color:var(--blush)]/60 p-5 sm:w-[60%] md:w-[45%]"
                  >
                    <span aria-hidden className="absolute right-4 top-3 font-display text-3xl text-[color:var(--navy)]/20">”</span>
                    <blockquote className="text-[color:var(--navy)]/85">{t.quote}</blockquote>
                    <figcaption className="mt-5 flex items-center gap-3">
                      <img src={t.avatar} alt={t.name} className="h-10 w-10 rounded-full object-cover" />
                      <div>
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-[color:var(--muted-foreground)]">{t.batch}</p>
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Block>

            <Block title="The plan">
              <div className="space-y-3">
                {trip.itinerary.map((d, idx) => <DayAccordion key={d.day} day={d} defaultOpen={idx === 0} />)}
              </div>
            </Block>

            <Block title="What's included">
              <div className="grid gap-8 sm:grid-cols-2">
                <ul className="space-y-2.5">
                  {trip.included.map((i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm"><Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" strokeWidth={2.5} />{i}</li>
                  ))}
                </ul>
                <ul className="space-y-2.5">
                  {trip.excluded.map((i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-[color:var(--muted-foreground)]"><X className="mt-0.5 h-4 w-4 flex-none" />{i}</li>
                  ))}
                </ul>
              </div>
            </Block>

            {trip.meetingPoint && (
              <Block title="Meeting point">
                <p className="text-[color:var(--navy)]/85">{trip.meetingPoint}</p>
              </Block>
            )}
          </div>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="space-y-5 rounded-2xl bg-white p-7 shadow-[0_8px_40px_-20px_rgba(27,43,58,0.25)]">
              <div>
                <p className="text-xs uppercase tracking-widest text-[color:var(--muted-foreground)]">From</p>
                <p className="font-display text-4xl text-[color:var(--coral)]">₹{selected?.price.toLocaleString("en-IN")}</p>
                <p className="text-xs text-[color:var(--muted-foreground)]">per person</p>
              </div>

              {trip.batches.length > 1 ? (
                <BatchPicker batches={trip.batches} selectedId={batchId} onSelect={setBatchId} />
              ) : selected ? (
                <div className="rounded-xl border border-[color:var(--peach)] p-4">
                  <p className="text-sm font-medium">{selected.startDate} — {selected.endDate}</p>
                  <Progress batch={selected} />
                </div>
              ) : null}

              <div className="rounded-xl bg-[color:var(--blush)] p-4">
                <p className="text-xs uppercase tracking-widest text-[color:var(--navy)]/60">Advance to confirm spot</p>
                <p className="font-display text-2xl text-[color:var(--coral)]">₹{trip.advanceAmount.toLocaleString("en-IN")}</p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">Pay now · Balance due before trip</p>
              </div>

              {open ? (
                <a href="#register" className="btn-coral w-full">Save my spot →</a>
              ) : (
                <span className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-full bg-gray-200 px-6 py-3.5 text-sm font-medium text-gray-500">
                  {soldOut ? "Sold out" : "Registration closed"}
                </span>
              )}

              <p className="text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                Run by Zahra and a small team who've actually done these routes. Real humans, one WhatsApp away.
              </p>

              <div className="flex items-center justify-between border-t border-[color:var(--peach)] pt-4 text-xs text-[color:var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{trip.duration}</span>
                <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Max {trip.groupSizeMax}</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* Registration */}
      <section id="register" className="bg-[color:var(--blush)] py-12">
        <div className="mx-auto max-w-3xl px-6">
          {open ? <RegistrationForm tripName={trip.title} advance={trip.advanceAmount} price={selected?.price ?? 0} /> : (
            <div className="rounded-2xl bg-white p-10 text-center">
              <h2 className="font-display text-3xl">All spots on this trip are filled</h2>
              <p className="mt-3 text-[color:var(--muted-foreground)]">But there's more coming. Plenty more.</p>
              <Link to="/trips" className="btn-coral mt-6 inline-flex">See other trips →</Link>
            </div>
          )}
        </div>
      </section>

      {/* Mobile sticky bar */}
      {open && (
        <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-[color:var(--peach)] bg-white px-4 py-3 lg:hidden">
          <div>
            <p className="font-display text-xl text-[color:var(--coral)]">₹{selected?.price.toLocaleString("en-IN")}</p>
            <p className="text-[10px] text-[color:var(--muted-foreground)]">per person</p>
          </div>
          <a href="#register" className="btn-coral !py-2.5 !px-5 !text-sm">Save my spot →</a>
        </div>
      )}
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 font-display text-3xl lg:text-4xl">{title}</h2>
      {children}
    </div>
  );
}

function DayAccordion({ day, defaultOpen }: { day: import("@/lib/trips").ItineraryDay; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-[color:var(--peach)] bg-white p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-[color:var(--coral)]">Day {day.day}</p>
          <p className="mt-1 font-display text-lg">{day.title}</p>
        </div>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--blush)] text-[color:var(--coral)] transition-transform group-open:rotate-45 text-lg">+</span>
      </summary>
      <div className="mt-4 space-y-3 text-sm text-[color:var(--navy)]/80">
        <p>{day.description}</p>
        <div className="flex flex-wrap gap-2 pt-2 text-xs">
          {day.stay && <span className="rounded-full bg-[color:var(--blush)] px-3 py-1">Stay: {day.stay}</span>}
          {day.meals && <span className="rounded-full bg-[color:var(--blush)] px-3 py-1">Meals: {day.meals}</span>}
          {day.transport && <span className="rounded-full bg-[color:var(--blush)] px-3 py-1">Transport: {day.transport}</span>}
        </div>
        {day.note && <p className="rounded-lg bg-[color:var(--blush)]/60 p-3 text-xs italic">Note: {day.note}</p>}
      </div>
    </details>
  );
}

function BatchPicker({ batches, selectedId, onSelect }: { batches: Batch[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-[color:var(--navy)]/60">Choose your dates</p>
      {batches.map((b) => {
        const sold = b.bookedSpots >= b.totalSpots;
        const active = b.id === selectedId;
        return (
          <button
            key={b.id}
            disabled={sold}
            onClick={() => onSelect(b.id)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${sold ? "cursor-not-allowed opacity-50" : ""} ${active ? "border-[color:var(--coral)] bg-[color:var(--blush)]" : "border-[color:var(--peach)] bg-white hover:border-[color:var(--coral)]/60"}`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{b.startDate} — {b.endDate}</p>
              <p className="font-display text-base text-[color:var(--coral)]">₹{b.price.toLocaleString("en-IN")}</p>
            </div>
            <Progress batch={b} />
          </button>
        );
      })}
    </div>
  );
}

function Progress({ batch }: { batch: Batch }) {
  const remaining = batch.totalSpots - batch.bookedSpots;
  const low = remaining <= 4;
  const pct = (batch.bookedSpots / batch.totalSpots) * 100;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-[color:var(--muted-foreground)]">
        <span>{batch.bookedSpots}/{batch.totalSpots} booked</span>
        <span className={low ? "font-medium text-[color:var(--coral)]" : ""}>{remaining} spots left</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--peach)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: low ? "var(--coral)" : "var(--navy)" }} />
      </div>
    </div>
  );
}

function RegistrationForm({ tripName, advance, price }: { tripName: string; advance: number; price: number }) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_10px_40px_-20px_rgba(27,43,58,0.25)] lg:p-10">
      <h2 className="font-display text-3xl lg:text-4xl">Save your spot on {tripName}</h2>

      <form onSubmit={(e) => { e.preventDefault(); setSubmitting(true); setTimeout(() => { window.location.href = `/thank-you?trip=${encodeURIComponent(tripName)}`; }, 500); }} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" name="name" required />
          <Field label="Email address" name="email" type="email" required />
          <Field label="Phone number" name="phone" placeholder="+91 ..." required />
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">Gender <span className="text-[color:var(--coral)]">*</span></label>
            <select className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none">
              <option>Prefer not to say</option><option>Female</option><option>Male</option><option>Non-binary</option>
            </select>
          </div>
          <Field label="City" name="city" required />
        </div>
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">What made you want to join this one?</label>
          <textarea required rows={4} className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none" />
        </div>

        <div className="rounded-xl bg-[color:var(--blush)] p-5">
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1">Advance amount (now)</td><td className="py-1 text-right font-medium text-[color:var(--coral)]">₹{advance.toLocaleString("en-IN")}</td></tr>
              <tr><td className="py-1 text-[color:var(--muted-foreground)]">Balance (15 days before trip)</td><td className="py-1 text-right">₹{(price - advance).toLocaleString("en-IN")}</td></tr>
              <tr className="border-t border-[color:var(--peach)]"><td className="pt-2">Total</td><td className="pt-2 text-right font-medium">₹{price.toLocaleString("en-IN")}</td></tr>
            </tbody>
          </table>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-[color:var(--muted-foreground)]">
            <li>Open any UPI app (GPay, PhonePe, Paytm)</li>
            <li>Pay ₹{advance} to <span className="font-mono">zahra@upi</span></li>
            <li>Screenshot the receipt and upload it below</li>
          </ol>
        </div>

        <div className="rounded-xl border-2 border-dashed border-[color:var(--peach)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          Drop your payment screenshot here, or <span className="font-medium text-[color:var(--coral)]">tap to upload</span>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1 accent-[color:var(--coral)]" /> I agree to the <Link to="/terms" className="underline">Terms & Conditions</Link></label>
          <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1 accent-[color:var(--coral)]" /> I've read the <Link to="/cancellation" className="underline">Cancellation Policy</Link></label>
        </div>

        <button disabled={submitting} type="submit" className="btn-coral w-full !py-4 disabled:opacity-60">
          {submitting ? "Submitting..." : "Save my spot →"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">
        {label}
        {required && <span className="text-[color:var(--coral)]"> *</span>}
      </label>
      <input name={name} type={type} required={required} placeholder={placeholder} className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none" />
    </div>
  );
}