import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Folevi",
    short_name: "Folevi",
    description: "A quieter place for ideas that keep growing.",
    start_url: "/documents",
    scope: "/",
    display: "standalone",
    background_color: "#F4F1E9",
    theme_color: "#F4F1E9",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New document", url: "/documents?new=1" },
      { name: "Today's tasks", url: "/tasks/today" },
      { name: "Daily note", url: "/daily" },
    ],
  };
}
