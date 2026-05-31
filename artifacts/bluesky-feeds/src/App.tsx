import { useState } from "react";
import { Switch, Route, Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toaster";
import {
  LayoutDashboard,
  Rss,
  BarChart2,
  Users,
  PenSquare,
  FileText,
  Bell,
  Settings,
  Globe,
  Menu,
  X,
  Zap,
} from "lucide-react";

// ─── Page imports ─────────────────────────────────────────────────────────────
import Dashboard from "./pages/Dashboard";
import Feeds from "./pages/Feeds";
import FeedDetail from "./pages/FeedDetail";
import Analytics from "./pages/Analytics";
import Audience from "./pages/Audience";
import Compose from "./pages/Compose";
import Posts from "./pages/Posts";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import Reach from "./pages/Reach";
import NotFound from "./pages/not-found";

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: "/",              label: "Dashboard",     icon: LayoutDashboard },
  { path: "/feeds",         label: "Feeds",         icon: Rss },
  { path: "/analytics",     label: "Analytics",     icon: BarChart2 },
  { path: "/audience",      label: "Audience",      icon: Users },
  { path: "/compose",       label: "Compose",       icon: PenSquare },
  { path: "/posts",         label: "Posts",         icon: FileText },
  { path: "/notifications", label: "Notifications", icon: Bell },
  { path: "/reach",         label: "Global Reach",  icon: Globe },
  { path: "/settings",      label: "Settings",      icon: Settings },
] as const;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full w-60 flex flex-col",
          "bg-card border-r border-border/50",
          "transition-transform duration-300 ease-in-out",
          // Mobile: slide in/out
          "md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border/40">
          <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
            <Zap className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground tracking-tight">FeedForge</span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 md:hidden"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = path === "/"
              ? location === "/"
              : location.startsWith(path);

            return (
              <Link key={path} href={path}>
                <a
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground/50 text-center">
            FeedForge v1.2.1
          </p>
        </div>
      </aside>
    </>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────

function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const [location] = useLocation();
  const current = NAV_ITEMS.find(({ path }) =>
    path === "/" ? location === "/" : location.startsWith(path)
  );

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-background/80 backdrop-blur-sm md:px-6">
      <button
        onClick={onMenuClick}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 md:hidden"
      >
        <Menu className="w-5 h-5" />
      </button>
      <span className="text-sm font-semibold text-foreground">
        {current?.label ?? "FeedForge"}
      </span>
    </header>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar — always visible on md+, drawer on mobile */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content — offset by sidebar width on md+ */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-60">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-auto">
          <Switch>
            <Route path="/"              component={Dashboard} />
            <Route path="/feeds"         component={Feeds} />
            <Route path="/feeds/:id"     component={FeedDetail} />
            <Route path="/analytics"     component={Analytics} />
            <Route path="/audience"      component={Audience} />
            <Route path="/compose"       component={Compose} />
            <Route path="/posts"         component={Posts} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/settings"      component={Settings} />
            <Route path="/reach"         component={Reach} />
            <Route                       component={NotFound} />
          </Switch>
        </main>
      </div>

      <Toaster />
    </div>
  );
}
