"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function SearchBar({ placeholder = "Buscar canales…", className }: { placeholder?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [value, setValue] = useState(urlQuery);
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery);
  const [pending, startTransition] = useTransition();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync when the URL changes (back/forward, chips)
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  function onChange(next: string) {
    setValue(next);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => push(next), 350);
  }

  return (
    <div className={cn("relative", className)}>
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2",
          pending ? "animate-pulse text-brand-2" : "text-slate-500",
        )}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (timeout.current) clearTimeout(timeout.current);
            push(value);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-surface-3/80 py-3 pr-10 pl-11 text-sm text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            push("");
          }}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          aria-label="Limpiar búsqueda"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
