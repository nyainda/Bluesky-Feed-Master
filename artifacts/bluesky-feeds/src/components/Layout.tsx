import { Link, useLocation } from "wouter";
import { LayoutDashboard, Rss, FileText, Settings, Wifi, WifiOff, BarChart3, Users2 } from "lucide-react";
import { useGetFirehoseStatus, useGetStatsOverview, useGetBlueskyProfile } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/feeds", label: "Feeds", icon: Rss },
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
          <span className={cn("text-xs font-medium", firehose?.connected ? "text-emerald-400" : "text-red-400")}>
            {firehose?.connected ? "Firehose Live" : "Firehose Offline"}
          </span>
          <span className="text-sidebar-foreground/40 text-xs ml-auto tabular-nums">
            {firehose?.reconnectCount ?? 0} rc
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div>
            <div className="text-sidebar-foreground/40 text-[10px] uppercase tracking-wide">Indexed</div>
            <div className="text-sidebar-foreground text-xs font-semibold tabular-nums">
              {(firehose?.postsIndexedTotal ?? 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sidebar-foreground/40 text-[10px] uppercase tracking-wide">24h Posts</div>
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
  if (!profile) return null;
  return (
    <div className="px-3 py-3 border-b border-sidebar-border">
      <div className="flex items-center gap-2.5">
        {profile.avatar ? (
          <img src={profile.avatar} alt={profile.handle} className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-sidebar-border" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary flex-shrink-0 flex items-center justify-center text-white text-xs font-bold">
            {(profile.displayName || profile.handle)[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sidebar-foreground text-xs font-semibold truncate">{profile.displayName || profile.handle}</div>
          <div className="text-sidebar-foreground/40 text-[10px] truncate">@{profile.handle}</div>
        </div>
      </div>
      <div className="flex gap-3 mt-2 px-0.5">
        <div className="text-center">
          <div className="text-sidebar-foreground text-xs font-bold tabular-nums">{(profile.followersCount).toLocaleString()}</div>
          <div className="text-sidebar-foreground/40 text-[10px]">followers</div>
        </div>
        <div className="text-center">
          <div className="text-sidebar-foreground text-xs font-bold tabular-nums">{(profile.followsCount).toLocaleString()}</div>
          <div className="text-sidebar-foreground/40 text-[10px]">following</div>
        </div>
        <div className="text-center">
          <div className="text-sidebar-foreground text-xs font-bold tabular-nums">{(profile.postsCount).toLocaleString()}</div>
          <div className="text-sidebar-foreground/40 text-[10px]">posts</div>
        </div>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shadow-md shadow-primary/30">
              <Rss className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="text-sidebar-foreground font-bold text-sm leading-tight tracking-tight">FeedForge</div>
              <div className="text-sidebar-foreground/40 text-[10px] tracking-wide">BLUESKY FEEDS</div>
            </div>
          </div>
        </div>

        <ProfileCard />

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}>
                <motion.div
                  whileHover={{ x: 2 }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium cursor-pointer transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {label}
                  {active && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="w-1 h-1 rounded-full bg-sidebar-primary-foreground/60 ml-auto"
                    />
                  )}
                </motion.div>
              </Link>
            );
          })}
        </nav>

        <FirehoseIndicator />
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <motion.div
          key={location}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
