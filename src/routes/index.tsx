import { createFileRoute } from "@tanstack/react-router";
import { ComparePage } from "./-components/compare-page";
import { validateSearch } from "./-lib/search";

export const Route = createFileRoute("/")({ validateSearch, component: ComparePage });
