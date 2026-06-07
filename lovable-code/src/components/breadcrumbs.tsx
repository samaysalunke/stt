import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export type Crumb = {
  label: string;
  to?: string;
  params?: Record<string, string>;
};

type Props = {
  items: Crumb[];
  /** Use light variant when sitting over dark hero imagery. */
  variant?: "light" | "dark";
  className?: string;
};

export function Breadcrumbs({ items, variant = "dark", className }: Props) {
  const isLight = variant === "light";
  const baseColor = isLight ? "text-white/80" : "text-[color:var(--navy)]/70";
  const linkHover = isLight ? "hover:text-white" : "hover:text-[color:var(--coral)]";
  const currentColor = isLight ? "text-white" : "text-[color:var(--navy)]";

  return (
    <nav
      aria-label="Breadcrumb"
      className={"flex flex-wrap items-center gap-1 text-xs sm:text-sm " + baseColor + " " + (className ?? "")}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {item.to && !isLast ? (
              <Link
                to={item.to}
                params={item.params as never}
                className={"transition-colors " + linkHover}
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium " + currentColor : ""}>{item.label}</span>
            )}
            {!isLast && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
          </span>
        );
      })}
    </nav>
  );
}