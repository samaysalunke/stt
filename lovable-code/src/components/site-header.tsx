import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { to: "/trips", label: "Trips" },
  { to: "/about", label: "Our Story" },
  { to: "/faq", label: "FAQ" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[color:var(--peach)]/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-full font-display text-lg text-white"
            style={{ background: "var(--coral)" }}
          >
            S
          </span>
          <span className="hidden font-display text-lg font-medium tracking-tight sm:inline">
            Seek the Thrill
          </span>
        </Link>

        <nav className="hidden items-center gap-9 lg:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-sm font-medium text-[color:var(--navy)]/75 transition-colors hover:text-[color:var(--coral)]"
              activeProps={{ className: "text-sm font-medium text-[color:var(--coral)]" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link to="/trips" className="btn-coral hidden lg:inline-flex !py-2.5 !px-5 !text-sm">
          Join a trip
        </Link>

        <button
          aria-label="Open menu"
          className="rounded-full p-2 lg:hidden"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-[78%] max-w-sm flex-col bg-white p-6">
            <div className="mb-8 flex items-center justify-between">
              <span className="font-display text-lg">Seek the Thrill</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-base font-medium text-[color:var(--navy)]/80"
                  activeProps={{
                    className:
                      "rounded-lg px-3 py-3 text-base font-medium text-[color:var(--coral)] bg-[color:var(--blush)]",
                  }}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto">
              <Link to="/trips" onClick={() => setOpen(false)} className="btn-coral w-full">
                Join a trip
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}