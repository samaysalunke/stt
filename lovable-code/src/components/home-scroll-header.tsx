import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const links = [
  { to: "/trips", label: "Trips" },
  { to: "/about", label: "Our Story" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
  { to: "/cancellation", label: "Cancellation Policy" },
  { to: "/terms", label: "Terms" },
] as const;

export function HomeScrollHeader() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.header
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed top-0 left-0 right-0 z-40 border-b border-[color:var(--peach)]/60 bg-[color:var(--navy)]/90 backdrop-blur-md"
          >
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-8">
              <Link to="/" className="flex items-center gap-2.5">
                <span
                  className="grid h-9 w-9 place-items-center rounded-full font-display text-lg text-white"
                  style={{ background: "var(--coral)" }}
                >
                  S
                </span>
                <span className="font-display text-base font-medium tracking-tight text-white sm:text-lg">
                  Seek the Thrill
                </span>
              </Link>

              <button
                aria-label="Open menu"
                className="rounded-full p-2 text-white"
                onClick={() => setOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {open && (
        <div className="fixed inset-0 z-50">
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
    </>
  );
}