import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
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

export default function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/feeds" component={Feeds} />
        <Route path="/feeds/:id" component={FeedDetail} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/audience" component={Audience} />
        <Route path="/compose" component={Compose} />
        <Route path="/posts" component={Posts} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/settings" component={Settings} />
        <Route path="/reach" component={Reach} />
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </>
  );
}
