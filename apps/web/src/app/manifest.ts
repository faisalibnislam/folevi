import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Folevi",
    short_name: "Folevi",
    description: "A quiet notes app for ideas that keep growing.",
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
    // Android and desktop Chromium list Folevi in the share sheet; the service worker keeps what's shared
    // (public/sw.js) and the app saves it to the Inbox from /share. Without the service worker yet, the
    // server's /share-target takes the text and link.
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"] }] },
    },
    shortcuts: [
      { name: "New document", url: "/documents?new=1" },
      { name: "Today's tasks", url: "/tasks/today" },
    ],
  };
}
