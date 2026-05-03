import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Feeds from "@/pages/Feeds";
import FeedDetail from "@/pages/FeedDetail";
import Posts from "@/pages/Posts";
import Analytics from "@/pages/Analytics";
import Audience from "@/pages/Audience";
import Settings from "@/pages/Settings";
import Compose from "@/pages/Compose";
import Notifications from "@/pages/Notifications";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/feeds" component={Feeds} />
        <Route path="/feeds/:id" component={FeedDetail} />
        <Route path="/posts" component={Posts} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/audience" component={Audience} />
        <Route path="/compose" component={Compose} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
