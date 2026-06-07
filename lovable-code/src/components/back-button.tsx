import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

type Props = {
  /** Where to go if there's no history to pop back to. Defaults to "/". */
  fallback?: string;
  /** Optional label override. */
  label?: string;
  /** Extra classes for positioning, e.g. "absolute" vs default "fixed". */
  className?: string;
};

/**
 * Floating back button shown top-left on inner pages.
 * Tries router.history.back() first; falls back to <Link to={fallback}>.
 */
export function BackButton({ fallback = "/", label = "Back", className }: Props) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    // If we have history beyond the initial entry, go back.
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.history.back();
    }
    // else let the Link navigate to fallback
  };

  return (
    <Link
      to={fallback}
      onClick={handleClick}
      aria-label={label}
      className={
        "fixed top-4 left-4 z-30 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--peach)]/70 bg-white/85 px-3 py-2 text-sm font-medium text-[color:var(--navy)] shadow-sm backdrop-blur-md transition-colors hover:bg-white hover:text-[color:var(--coral)] " +
        (className ?? "")
      }
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}