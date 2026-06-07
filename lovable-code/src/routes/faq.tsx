import { createFileRoute } from "@tanstack/react-router";
import { BackButton } from "@/components/back-button";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — Seek the Thrill" },
      { name: "description", content: "Answers to things people actually ask before booking." },
      { property: "og:title", content: "FAQ — Seek the Thrill" },
      { property: "og:description", content: "Answers to things people actually ask before booking." },
    ],
  }),
  component: FAQ,
});

const groups = [
  {
    title: "Booking",
    items: [
      ["How do I reserve a spot?", "Fill the form on the trip page, pay the ₹3,000 advance via UPI, upload your screenshot. You'll get a confirmation email within 24 hours."],
      ["Can I book for a group of friends?", "Yes. Each person fills the form individually so we have everyone's details and they get their own confirmation."],
      ["What happens after I register?", "You'll get an instant 'we got it' email. Within 24 hours, a real confirmation. Then a trip prep guide. Then we'll add you to the WhatsApp group about 2 weeks before."],
      ["Can I transfer my spot to someone else?", "Yes, up to 7 days before the trip. Email zahra@seekthethrill.in with the new person's details."],
    ],
  },
  {
    title: "Payment",
    items: [
      ["How much is the advance?", "Flat ₹3,000 for any trip. It confirms your spot."],
      ["When is the rest due?", "15 days before the trip start date. We'll send a reminder."],
      ["What payment methods do you accept?", "UPI only for now. It keeps the overhead low so trip prices stay reasonable."],
      ["What's the refund policy if I cancel?", "30+ days out: full refund minus ₹500. 15–29 days: 50%. 7–14 days: 25%. Under 7 days: no refund. See full policy."],
    ],
  },
  {
    title: "What to expect",
    items: [
      ["Who else is on these trips?", "Mostly 22–35 year olds. About half solo, half in pairs or small groups. Mix of genders, mix of cities."],
      ["How big are the groups?", "8 to 16 people max. Most trips end up at 10–12. We don't run anything bigger."],
      ["Do I need to be fit?", "Depends on the trip. Beaches and culture trips — no. Treks and high-altitude — moderate fitness, but we'll tell you upfront on the trip page."],
      ["Is it okay to come alone?", "Yes — about half our travellers do. By Day 2 you won't be alone anymore."],
    ],
  },
  {
    title: "Safety & logistics",
    items: [
      ["Is it safe for solo women?", "Yes. Zahra leads or co-leads every trip. We choose vetted stays. And the group sticks together."],
      ["Can you handle dietary restrictions?", "Vegetarian and Jain are easy. Vegan and gluten-free we can usually arrange — just tell us when registering."],
      ["Do you book flights or trains?", "No. We give you the meeting point and end point. You book your own travel — most people prefer the flexibility."],
      ["What do I need to pack?", "We send a detailed prep guide after registration with a trip-specific packing list."],
    ],
  },
];

function FAQ() {
  return (
    <>
      <BackButton />
      <section className="bg-[color:var(--blush)] py-16">
        <div className="mx-auto max-w-5xl px-4 text-center">
          <h1 className="font-display text-5xl lg:text-6xl">Questions</h1>
          <p className="mt-4 text-[color:var(--muted-foreground)]">Answers to things people actually ask.</p>
        </div>
      </section>
      <section className="bg-[color:var(--gray-soft)] py-20">
        <div className="mx-auto max-w-3xl space-y-14 px-4">
          {groups.map((g) => (
            <div key={g.title}>
              <h2 className="mb-5 font-display text-2xl text-[color:var(--coral)]">{g.title}</h2>
              <div className="space-y-3">
                {g.items.map(([q, a]) => (
                  <details key={q} className="group rounded-xl border border-[color:var(--peach)] bg-white p-5 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex cursor-pointer items-start justify-between gap-4 font-medium">
                      <span>{q}</span>
                      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[color:var(--blush)] text-[color:var(--coral)] transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-[color:var(--navy)]/75">{a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-2xl bg-[color:var(--blush)] p-8 text-center">
            <p className="font-display text-2xl">Still have a question?</p>
            <a href="https://wa.me/917975027491" target="_blank" rel="noreferrer" className="btn-coral mt-5 inline-flex">Ask on WhatsApp →</a>
          </div>
        </div>
      </section>
    </>
  );
}