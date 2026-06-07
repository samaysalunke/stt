import { createFileRoute } from "@tanstack/react-router";
import { Mail, Phone, MessageCircle, Clock, Instagram } from "lucide-react";
import { useState } from "react";
import community from "@/assets/community.jpg";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Seek the Thrill" },
      { name: "description", content: "Trip doubts, payment questions, solo-travel nerves. Ask us anything." },
      { property: "og:title", content: "Contact — Seek the Thrill" },
      { property: "og:description", content: "Trip doubts, payment questions, solo-travel nerves." },
    ],
  }),
  component: Contact,
});

function Contact() {
  const [sent, setSent] = useState(false);
  const cards = [
    { Icon: Mail, t: "Email", v: "zahra@seekthethrill.in", n: "Reply within 24–48 hours" },
    { Icon: Phone, t: "Call", v: "+91 79750 27491", n: "Mon–Sat, 9 AM – 7 PM IST" },
    { Icon: MessageCircle, t: "WhatsApp", v: "Chat instantly", n: "Fastest response channel" },
    { Icon: Clock, t: "Response time", v: "Within 24 hrs", n: "Usually much faster on WhatsApp" },
  ];
  return (
    <>
      <BackButton />
      <section className="relative h-[42vh] min-h-[320px] overflow-hidden">
        <img src={community} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col justify-end px-4 pb-12 text-white">
          <h1 className="font-display text-[clamp(2.25rem,5vw,4rem)] font-medium leading-tight text-white">You can just ask.</h1>
          <p className="mt-3 max-w-xl text-white/85">Trip doubts, solo-travel nerves, payment questions — anything.</p>
        </div>
      </section>

      <section className="bg-[color:var(--gray-soft)] py-16">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            {cards.map(({ Icon, t, v, n }) => (
              <div key={t} className="flex items-start gap-4 rounded-2xl bg-white p-5">
                <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-[color:var(--blush)] text-[color:var(--coral)]">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs uppercase tracking-widest text-[color:var(--muted-foreground)]">{t}</p>
                  <p className="font-display text-lg">{v}</p>
                  <p className="text-xs text-[color:var(--muted-foreground)]">{n}</p>
                </div>
              </div>
            ))}
            <a href="https://instagram.com/seekthethrill_" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm text-[color:var(--coral)]">
              <Instagram className="h-4 w-4" /> @seekthethrill_
            </a>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="rounded-2xl bg-white p-8 shadow-sm lg:p-10">
            {sent ? (
              <div className="py-12 text-center">
                <p className="font-display text-3xl">Sent.</p>
                <p className="mt-2 text-[color:var(--muted-foreground)]">We'll get back to you soon.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <h2 className="font-display text-3xl">Send a message</h2>
                <input style={{ display: "none" }} tabIndex={-1} autoComplete="off" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Full name" required />
                  <Input label="Email" type="email" required />
                  <Input label="Phone" />
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">Subject</label>
                    <select className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none">
                      <option>Trip inquiry</option><option>Booking issue</option><option>Group booking</option><option>Cancellation / refund</option><option>General question</option><option>Feedback</option><option>Partnership</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">Message</label>
                  <textarea required rows={5} className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none" />
                </div>
                <button type="submit" className="btn-coral !py-3">Send it</button>
              </div>
            )}
          </form>
        </div>
      </section>
    </>
  );
}

function Input({ label, type = "text", required }: { label: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-widest text-[color:var(--navy)]/60">{label}</label>
      <input type={type} required={required} className="w-full rounded-lg border border-[color:var(--peach)] bg-white px-4 py-3 text-sm focus:border-[color:var(--coral)] focus:outline-none" />
    </div>
  );
}