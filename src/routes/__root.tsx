import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Side by Side" },
      { name: "description", content: "One URL in Firefox, Chromium and Epiphany, each running in a Linux VM in this tab." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    // Static hosts can't send COOP/COEP, which the VMs need for SharedArrayBuffer; this service
    // worker adds them (and reloads once). coepCredentialless off for Safari.
    scripts: [{ children: "window.coi = { coepCredentialless: () => false };" }, { src: "/coi-serviceworker.js" }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
