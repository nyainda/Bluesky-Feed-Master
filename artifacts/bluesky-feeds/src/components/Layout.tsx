import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Rss, FileText, Settings, Wifi, WifiOff,
  BarChart3, Users2, Menu, X, ChevronRight, PenLine, Bell,
} from "lucide-react";
import { useGetFirehoseStatus, useGetStatsOverview, useGetBlueskyProfile } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/compose", label: "Compose", icon: PenLine },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audience", label: "Audience", icon: Users2 },
  { href: "/posts", label: "Posts", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function FirehoseIndicator() {
  const { data: firehose } = useGetFirehoseStatus({
    query: { refetchInterval: 5000, queryKey: ["firehose-status-layout"] },
  });
  const { data: overview } = useGetStatsOverview({
    query: { refetchInterval: 10000, queryKey: ["overview-layout"] },
  });

  return (
    <div className="px-3 py-3 border-t border-sidebar-border">
      <div className="rounded-lg bg-sidebar-accent px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-shrink-0">
            {firehose?.connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </>
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            )}
          </div>
          <span className={cn("text-xs font-medium tracking-tight", firehose?.connected ? "text-emerald-400" : "text-red-400")}>
            {firehose?.connected ? "Firehose Live" : "Offline"}
          </span>
          <span className="text-sidebar-foreground/30 text-[10px] ml-auto tabular-nums">
            {firehose?.reconnectCount ?? 0} rc
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <div className="bg-sidebar-border/40 rounded-md px-2 py-1.5">
            <div className="text-sidebar-foreground/40 text-[9px] uppercase tracking-widest mb-0.5">Indexed</div>
            <div className="text-sidebar-foreground text-xs font-semibold tabular-nums">
              {(firehose?.postsIndexedTotal ?? 0).toLocaleString()}
            </div>
          </div>
          <div className="bg-sidebar-border/40 rounded-md px-2 py-1.5">
            <div className="text-sidebar-foreground/40 text-[9px] uppercase tracking-widest mb-0.5">24h</div>
            <div className="text-sidebar-foreground text-xs font-semibold tabular-nums">
              {(overview?.postsLast24h ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileCard() {
  const { data: profile } = useGetBlueskyProfile({
    query: { retry: false, queryKey: ["profile-layout"] },
  });
  if (!profile) return (
    <div className="px-3 py-3 border-b border-sidebar-border">
      <div className="h-10 rounded-lg bg-sidebar-accent animate-pulse" />
    </div>
  );
  return (
    <div className="px-3 py-3 border-b border-sidebar-border">
      <a
        href={`https://bsky.app/profile/${profile.handle}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 group"
      >
        {profile.avatar ? (
          <img src={profile.avatar} alt={profile.handle} className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-white/10" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-sidebar-primary flex-shrink-0 flex items-center justify-center text-white text-xs font-bold">
            {(profile.displayName || profile.handle)[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sidebar-foreground text-xs font-semibold truncate leading-tight">{profile.displayName || profile.handle}</div>
          <div className="text-sidebar-foreground/40 text-[10px] truncate">@{profile.handle}</div>
        </div>
        <ChevronRight className="w-3 h-3 text-sidebar-foreground/20 group-hover:text-sidebar-foreground/50 transition-colors flex-shrink-0" />
      </a>
      <div className="flex gap-0 mt-2.5 divide-x divide-sidebar-border">
        {[
          { label: "followers", value: profile.followersCount },
          { label: "following", value: profile.followsCount },
          { label: "posts", value: profile.postsCount },
        ].map(({ label, value }) => (
          <div key={label} className="flex-1 text-center py-0.5 first:pl-0 last:pr-0 px-1">
            <div className="text-sidebar-foreground text-xs font-bold tabular-nums">{value.toLocaleString()}</div>
            <div className="text-sidebar-foreground/35 text-[9px] tracking-wide">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NavContent({ onNavClick }: { onNavClick?: () => void }) {
  const [location] = useLocation();
  return (
    <>
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-lg bg-sidebar-primary flex items-center justify-center shadow-lg shadow-sidebar-primary/20 flex-shrink-0">
            <Rss className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <div className="text-sidebar-foreground font-bold text-sm leading-none tracking-tight">FeedForge</div>
            <div className="text-sidebar-foreground/30 text-[9px] tracking-widest uppercase mt-0.5">Bluesky Tools</div>
          </div>
        </div>
      </div>

      <ProfileCard />

      <nav className="flex-1 px-2 py-3 space-y-px overflow-y-auto scrollbar-thin">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href} onClick={onNavClick}>
              <div
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150",
                  active
                    ? "bg-sidebar-primary text-white shadow-sm"
                    : "text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{label}</span>
                {active && <div className="ml-auto w-1 h-1 rounded-full bg-white/50" />}
              </div>
            </Link>
          );
        })}
      </nav>

      <FirehoseIndicator />
    </>
  );
}

function BottomNav() {
  const [location] = useLocation();
  const mainItems = navItems.slice(0, 5);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden safe-area-pb">
      <div className="flex items-stretch h-14">
        {mainItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href} className="flex-1">
              <div className={cn(
                "flex flex-col items-center justify-center h-full gap-0.5 transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}>
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
                {active && <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />}
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
        <NavContent />
      </aside>

      {/* Mobile Top Bar */}
      <div className="flex md:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-background/95 backdrop-blur-sm border-b border-border items-center px-4 gap-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-56 bg-sidebar border-sidebar-border flex flex-col">
            <NavContent onNavClick={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <Rss className="w-3 h-3 text-white" />
          </div>
          <span className="text-sm font-bold text-foreground">FeedForge</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background pt-14 md:pt-0 pb-14 md:pb-0 scrollbar-thin">
        <AnimatePresence mode="wait">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Nav */}
      <BottomNav />
    </div>
  );
}
