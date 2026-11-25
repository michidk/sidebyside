import { createRouter } from "@tanstack/react-router";
import { parseSearch, stringifySearch } from "@/lib/search-params";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ routeTree, parseSearch, stringifySearch, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
