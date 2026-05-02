import { motion } from "framer-motion";
import { Copy, ExternalLink, CheckCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useGetFirehoseStatus } from "@workspace/api-client-react";

function CopyableCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mb-4">
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <code
          data-testid={`code-${label.toLowerCase().replace(/\s+/g, "-")}`}
          className="flex-1 bg-muted font-mono text-sm px-3 py-2 rounded-lg border border-border text-foreground truncate"
        >
          {value}
        </code>
        <Button variant="ghost" size="icon" onClick={copy} className="flex-shrink-0" data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-card-border rounded-xl p-6 shadow-sm mb-6"
    >
      <h2 className="text-sm font-semibold text-foreground mb-4">{title}</h2>
      {children}
    </motion.div>
  );
}

export default function Settings() {
  const { data: firehose } = useGetFirehoseStatus();
  const hostname = window.location.hostname;
  const publisherDid = import.meta.env.VITE_FEEDGEN_PUBLISHER_DID || "(set FEEDGEN_PUBLISHER_DID env var)";

  const serviceDid = `did:web:${hostname}`;
  const didDocUrl = `https://${hostname}/.well-known/did.json`;
  const describeFeedUrl = `https://${hostname}/xrpc/app.bsky.feed.describeFeedGenerator`;
  const getFeedSkeletonUrl = `https://${hostname}/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://${publisherDid}/app.bsky.feed.generator/YOUR_FEED_NAME`;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">XRPC endpoints and configuration for your Bluesky feed generator</p>
      </motion.div>

      <Section title="Service Identity">
        <CopyableCode value={serviceDid} label="Service DID (did:web)" />
        <CopyableCode value={didDocUrl} label="DID Document URL" />
        <div className="flex items-center gap-2 mt-2">
          <a href={didDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Verify DID document <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </Section>

      <Section title="XRPC Endpoints">
        <CopyableCode value={describeFeedUrl} label="describeFeedGenerator" />
        <CopyableCode value={getFeedSkeletonUrl} label="getFeedSkeleton (example)" />
        <p className="text-xs text-muted-foreground mt-2">
          Bluesky calls <code className="font-mono bg-muted px-1 rounded">getFeedSkeleton</code> when a user requests your feed. Replace <code className="font-mono bg-muted px-1 rounded">YOUR_FEED_NAME</code> with your feed's record name.
        </p>
      </Section>

      <Section title="Firehose Configuration">
        <CopyableCode value={firehose?.endpoint || "wss://jetstream2.us-east.bsky.network/subscribe"} label="Jetstream Endpoint" />
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div className="bg-muted/40 rounded-lg px-4 py-3">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className={`text-sm font-semibold mt-0.5 ${firehose?.connected ? "text-green-500" : "text-red-400"}`}>
              {firehose?.connected ? "Connected" : "Disconnected"}
            </div>
          </div>
          <div className="bg-muted/40 rounded-lg px-4 py-3">
            <div className="text-xs text-muted-foreground">Reconnects</div>
            <div className="text-sm font-semibold mt-0.5">{firehose?.reconnectCount ?? 0}</div>
          </div>
        </div>
      </Section>

      <Section title="Publishing Your Feed to Bluesky">
        <p className="text-sm text-muted-foreground mb-4">
          To make your feed available in the Bluesky app, you need to publish it using the AT Protocol. After creating your feed on the Feeds page and adding keywords, follow these steps:
        </p>
        <ol className="space-y-3 text-sm text-foreground">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
            <span>Make sure your server is deployed and the DID document is accessible at <code className="font-mono bg-muted px-1 rounded text-xs">{didDocUrl}</code></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
            <span>Set <code className="font-mono bg-muted px-1 rounded text-xs">FEEDGEN_HOSTNAME</code>, <code className="font-mono bg-muted px-1 rounded text-xs">FEEDGEN_PUBLISHER_DID</code>, <code className="font-mono bg-muted px-1 rounded text-xs">BLUESKY_HANDLE</code>, and <code className="font-mono bg-muted px-1 rounded text-xs">BLUESKY_APP_PASSWORD</code> as environment variables</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
            <span>Run <code className="font-mono bg-muted px-1 rounded text-xs">pnpm --filter @workspace/api-server run publish-feed</code> from your project root to register the feed in your Bluesky account</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
            <span>Your feed will be discoverable in the Bluesky app under your profile</span>
          </li>
        </ol>
        <a
          href="https://docs.bsky.app/docs/tutorials/creating-a-feed"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline"
        >
          Official Bluesky feed generator documentation <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </Section>
    </div>
  );
}
