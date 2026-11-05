"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  Baby,
  CalendarRange,
  CircleDot,
  Download,
  Heart,
  Home,
  ListVideo,
  LogOut,
  Menu,
  Radio,
  Settings2,
  Tv2,
  UserRound,
  X,
} from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { TimeText } from "@/components/time-text";
import { promptInstall, useInstallable } from "@/lib/pwa";
import { setTvMode, useTvMode } from "@/lib/tv-mode";
import { cn } from "@/lib/utils";

export interface SidebarCategory {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  channelCount: number;
}

export interface SidebarUser {
  name: string;
  username: string;
  host: string;
  kind: string;
  expiresAt: string | null;
}

export interface SidebarProfile {
  id: number;
  name: string;
  avatar: string;
  color: string;
  isKids: boolean;
}

interface SidebarProps {
  categories: SidebarCategory[];
  totalChannels: number;
  user: SidebarUser;
  profile: SidebarProfile;
  logoutAction: () => Promise<void>;
}

const NAV = [
  { href: "/", label: "Inicio", icon: Home, kids: true },
  { href: "/favorites", label: "Favoritos", icon: Heart, kids: true },
  { href: "/guide", label: "Guía TV", icon: CalendarRange, kids: true },
  { href: "/recordings", label: "Grabaciones", icon: CircleDot, kids: false },
  { href: "/playlists", label: "Fuentes", icon: ListVideo, kids: false },
  { href: "/manage", label: "Gestionar canales", icon: Settings2, kids: false },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className={cn(
          "grid place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 shadow-lg shadow-brand/30",
          compact ? "h-8 w-8 rounded-lg" : "h-10 w-10",
        )}
      >
        <Radio className={cn("text-white", compact ? "h-4 w-4" : "h-5 w-5")} />
      </span>
      <span>
        <span className={cn("block font-bold leading-tight tracking-tight text-white", compact ? "text-base" : "text-lg")}>
          GLYS<span className="text-gradient">TV</span>
          <span className="ml-1.5 rounded-md bg-gradient-to-r from-brand to-brand-2 px-1.5 py-0.5 align-middle text-[10px] font-extrabold tracking-wider text-white">
            PRO
          </span>
        </span>
        {!compact && <span className="block text-[11px] uppercase tracking-[0.18em] text-slate-400">IPTV Player</span>}
      </span>
    </span>
  );
}

function SidebarContent({
  categories,
  totalChannels,
  user,
  profile,
  logoutAction,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategory = pathname === "/" ? searchParams.get("category") : null;
  const tvMode = useTvMode();
  const installable = useInstallable();

  const nav = NAV.filter((item) => (profile.isKids ? item.kids : true));

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="px-5 pt-6 pb-4">
        <Brand />
      </Link>

      <nav className="px-3">
        <ul className="space-y-1">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" && !activeCategory : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                    active ? "bg-white/10 text-white shadow-inner" : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <item.icon className={cn("h-4.5 w-4.5", active ? "text-brand-2" : "text-slate-400")} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 flex items-center justify-between px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Categorías</p>
        <span className="text-[11px] text-slate-500">{totalChannels} canales</span>
      </div>
      <ul className="scrollbar-thin mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {categories
          .filter((cat) => cat.channelCount > 0 || activeCategory === cat.slug)
          .map((cat) => {
            const active = activeCategory === cat.slug;
            return (
              <li key={cat.id}>
                <Link
                  href={`/?category=${encodeURIComponent(cat.slug)}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                    active ? "bg-brand/20 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <CategoryIcon name={cat.icon} className={cn("h-4 w-4", active ? "text-brand-2" : "text-slate-500")} />
                  <span className="flex-1 truncate">{cat.name}</span>
                  <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-400">
                    {cat.channelCount}
                  </span>
                </Link>
              </li>
            );
          })}
        {categories.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Sin categorías todavía</li>}
      </ul>

      <div className="space-y-2 border-t border-white/5 px-3 py-3">
        {installable && (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-brand/30 to-brand-2/30 px-3 py-2 text-sm font-medium text-white hover:from-brand/40 hover:to-brand-2/40"
          >
            <Download className="h-4 w-4" /> Instalar aplicación
          </button>
        )}
        <button
          type="button"
          onClick={() => setTvMode(!tvMode)}
          aria-pressed={tvMode}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
        >
          <Tv2 className={cn("h-4 w-4", tvMode ? "text-brand-2" : "text-slate-500")} />
          <span className="flex-1 text-left">Modo TV (mando)</span>
          <span
            className={cn(
              "relative h-5 w-9 rounded-full transition",
              tvMode ? "bg-brand" : "bg-white/15",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition",
                tvMode ? "left-[18px]" : "left-0.5",
              )}
            />
          </span>
        </button>
      </div>

      <div className="border-t border-white/5 px-3 py-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg"
            style={{ background: `linear-gradient(135deg, ${profile.color}, ${profile.color}88)` }}
          >
            {profile.avatar}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
              {profile.name}
              {profile.isKids && <Baby className="h-3.5 w-3.5 text-brand-2" />}
            </p>
            <p className="truncate text-[11px] text-slate-500" title={`${user.username} · ${user.host}`}>
              {user.username} · {user.host}
            </p>
            {user.expiresAt && (
              <p className="truncate text-[11px] text-slate-500">
                Caduca <TimeText date={user.expiresAt} mode="datetime" />
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link
            href="/profiles"
            onClick={onNavigate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            <UserRound className="h-3.5 w-3.5" /> Cambiar perfil
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close the drawer after navigating
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="glass sticky top-0 z-40 flex items-center justify-between border-b border-white/5 px-4 py-3 lg:hidden">
        <Link href="/">
          <Brand compact />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-slate-200 hover:bg-white/10"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      <div
        className={cn("fixed inset-0 z-50 transition lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          className={cn("absolute inset-0 bg-black/60 transition-opacity", open ? "opacity-100" : "opacity-0")}
          onClick={() => setOpen(false)}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/5 bg-surface-2 shadow-2xl transition-transform",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-3 rounded-lg p-2 text-slate-300 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
          {open && (
            <Suspense fallback={null}>
              <SidebarContent {...props} onNavigate={() => setOpen(false)} />
            </Suspense>
          )}
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/5 bg-surface-2/80 backdrop-blur lg:block">
        <Suspense fallback={null}>
          <SidebarContent {...props} />
        </Suspense>
      </aside>
    </>
  );
}
