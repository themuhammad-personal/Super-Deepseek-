import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return <AppShell />;
}
