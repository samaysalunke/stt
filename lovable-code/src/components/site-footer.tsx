import { Link } from "@tanstack/react-router";
import { Instagram, MessageCircle } from "lucide-react";
import { useState } from "react";

export function SiteFooter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <footer className="bg-[color:var(--navy)] text-white/85">
      <div className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-4">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="font-display text-lg text-white">Seek the Thrill</span>
            </div>
            <p className="text-sm text-white/65">Small groups. Offbeat India.</p>
            <div className="mt-5 flex gap-3">
              <a
                href="https://instagram.com/seekthethrill_"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition-colors hover:bg-[color:var(--coral)]"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href="https://wa.me/917975027491"
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition-colors hover:bg-[color:var(--coral)]"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            </div>
          </div>

          <FooterCol title="Explore" links={[
            { to: "/trips", label: "Upcoming Trips" },
            { to: "/about", label: "Our Story" },
            { to: "/photo-vault", label: "Photo Vault" },
          ]} />
          <FooterCol title="Help" links={[
            { to: "/faq", label: "FAQ" },
            { to: "/contact", label: "Contact" },
            { href: "https://wa.me/917975027491", label: "WhatsApp Us" },
          ]} />
          <FooterCol title="Legal" links={[
            { to: "/terms", label: "Terms & Conditions" },
            { to: "/cancellation", label: "Cancellation Policy" },
            { to: "/terms", label: "Privacy Policy" },
          ]} />
        </div>

        <div className="mt-10 border-t border-white/10 pt-8">
          <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="font-display text-xl text-white">Stay in the loop</p>
              <p className="mt-1 text-sm text-white/60">New trips, real news. No spam.</p>
            </div>
            {done ? (
              <p className="text-sm text-[color:var(--coral)]">
                You're in. We'll be in touch when something good is coming.
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) setDone(true);
                }}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input
                  type="email"
                  required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm text-white placeholder:text-white/40 focus:border-[color:var(--coral)] focus:outline-none"
                />
                <button type="submit" className="btn-coral !py-3">Keep me posted</button>
              </form>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-5 text-xs text-white/45 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Seek the Thrill. All rights reserved.</p>
          <p>This site uses analytics cookies. <Link to="/terms" className="underline">Privacy</Link></p>
        </div>
      </div>
    </footer>
  );
}

type Link = { to?: string; href?: string; label: string };
function FooterCol({ title, links }: { title: string; links: Link[] }) {
  return (
    <div>
      <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/50">{title}</p>
      <ul className="space-y-2.5 text-sm">
        {links.map((l, i) => (
          <li key={i}>
            {l.to ? (
              <Link to={l.to} className="text-white/75 transition-colors hover:text-[color:var(--coral)]">
                {l.label}
              </Link>
            ) : (
              <a href={l.href} target="_blank" rel="noreferrer" className="text-white/75 transition-colors hover:text-[color:var(--coral)]">
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}