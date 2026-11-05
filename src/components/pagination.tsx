import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pages,
  basePath,
  params,
}: {
  page: number;
  pages: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const windowPages = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pages || Math.abs(p - page) <= 2,
  );

  const items: Array<number | "gap"> = [];
  for (let i = 0; i < windowPages.length; i++) {
    if (i > 0 && windowPages[i] - windowPages[i - 1] > 1) items.push("gap");
    items.push(windowPages[i]);
  }

  const btn = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm transition";

  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Paginación">
      <Link
        href={href(Math.max(1, page - 1))}
        aria-disabled={page === 1}
        className={cn(btn, page === 1 ? "pointer-events-none text-slate-600" : "text-slate-300 hover:bg-white/10")}
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      {items.map((it, idx) =>
        it === "gap" ? (
          <span key={`gap-${idx}`} className="px-1 text-slate-600">
            …
          </span>
        ) : (
          <Link
            key={it}
            href={href(it)}
            className={cn(btn, it === page ? "bg-brand text-white" : "text-slate-300 hover:bg-white/10")}
          >
            {it}
          </Link>
        ),
      )}
      <Link
        href={href(Math.min(pages, page + 1))}
        aria-disabled={page === pages}
        className={cn(btn, page === pages ? "pointer-events-none text-slate-600" : "text-slate-300 hover:bg-white/10")}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
