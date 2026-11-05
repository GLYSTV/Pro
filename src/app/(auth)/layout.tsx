import type { ReactNode } from "react";
import { Radio } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-cover bg-center opacity-40" style={{ backgroundImage: "url(/images/hero.jpg)" }} aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/70 via-surface/85 to-surface" aria-hidden />
      <div className="relative flex w-full flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-brand-2 shadow-lg shadow-brand/30">
            <Radio className="h-6 w-6 text-white" />
          </span>
          <span>
            <span className="block text-2xl font-bold tracking-tight text-white">
              GLYS<span className="text-gradient">TV</span>
              <span className="ml-2 rounded-md bg-gradient-to-r from-brand to-brand-2 px-1.5 py-0.5 align-middle text-xs font-extrabold tracking-wider text-white">
                PRO
              </span>
            </span>
            <span className="block text-[11px] uppercase tracking-[0.2em] text-slate-400">IPTV Player</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
