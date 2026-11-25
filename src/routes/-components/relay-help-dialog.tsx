import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// wisp-js-server's default address.
const LOCAL_RELAY = "ws://127.0.0.1:5001/";
const COMMAND = "npx -p @mercuryworkshop/wisp-js wisp-js-server";

// Resolves once the relay sends its first Wisp packet, which it does right after connecting.
const relayAnswers = (url: string) =>
  new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      ws.close();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 4000);
    ws.onmessage = () => done(true);
    ws.onerror = () => done(false);
  });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Put the local relay in the relay setting.
  onUse: (relay: string) => void;
}

// The guide for running the relay on your own computer.
export function RelayHelpDialog({ open, onOpenChange, onUse }: Props) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"checking" | "ok" | "bad" | null>(null);

  async function use() {
    onUse(LOCAL_RELAY);
    setStatus("checking");
    setStatus((await relayAnswers(LOCAL_RELAY)) ? "ok" : "bad");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Faster: run the relay on your computer</DialogTitle>
          <DialogDescription>
            The browsers in this page reach the internet through a relay, because a web page can't open network
            connections itself. By default that's a free public relay: shared, throttled, and websites see its IP
            address. Running the relay on your own computer takes that detour out, and websites see your own connection.
            It listens only on your computer, and the browsers can't reach your home network through it.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid list-decimal gap-3 pl-5">
          <li>
            Install{" "}
            <a href="https://nodejs.org/" target="_blank" rel="noopener" className="underline underline-offset-4">
              Node.js
            </a>{" "}
            (version 18 or newer) if you don't have it.
          </li>
          <li className="grid gap-2">
            Open a terminal and run this. Leave it running while you use this page; stop it with Ctrl+C.
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <code className="flex-1 font-mono text-xs break-all">{COMMAND}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(COMMAND);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <span>
              It prints <code className="font-mono text-xs">HTTP server listening on 127.0.0.1:5001</code> when it's
              ready.
            </span>
          </li>
          <li className="grid gap-2">
            Switch this page to it:
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={use}>Use local relay</Button>
              <span role="status" className={status === "ok" ? "text-green-600" : status === "bad" ? "text-destructive" : ""}>
                {status === "checking" && "Checking…"}
                {status === "ok" && "Connected. Press Open to use it."}
                {status === "bad" && "Not reachable. Is the command from step 2 still running?"}
              </span>
            </div>
            <span className="text-muted-foreground">
              If your browser asks to allow access to devices on your local network, allow it.
            </span>
          </li>
          <li>
            Press <strong>Open</strong>. To go back to the public relays, clear the Wisp relay field in Settings.
          </li>
        </ol>
        <DialogFooter>
          <p className="mr-auto self-center text-muted-foreground">
            The page itself still runs the browsers emulated, so expect faster page loads, not native speed.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
