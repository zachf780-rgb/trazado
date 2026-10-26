import { createFileRoute } from "@tanstack/react-router";
import { PlantApp } from "@/components/plant-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PlantApp />;
}
