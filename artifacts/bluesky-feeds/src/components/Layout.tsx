import { Link, useLocation } from "wouter";
import { LayoutDashboard, Rss, FileText, Settings, Wifi, WifiOff } from "lucide-react";
import { useGetFirehoseStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/feeds", label: "Feeds", icon: Rss },
  { href: "/posts", label: "Posts", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: firehose } = useGetFirehoseStatus({
    query: { refetchInterval: 5000, queryKey: ["firehose-status-layout"] },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-60 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-6 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
            </div>
            <div>
              <div className="text-sidebar-foreground font-semibold text-sm leading-tight">FeedForge</div>
              <div className="text-sidebar-foreground/50 text-xs">Bluesky Feed Generator</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <div
                  data-testid={`nav-${label.toLowerCase()}`}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent">
            <div className={cn("relative flex items-center justify-center")}>
              {firehose?.connected ? (
                <>
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                </>
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sidebar-foreground text-xs font-medium">
                {firehose?.connected ? "Firehose Active" : "Firehose Offline"}
              </div>
              <div className="text-sidebar-foreground/40 text-xs truncate">
                {firehose ? `${firehose.postsIndexedTotal.toLocaleString()} indexed` : "Connecting..."}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
