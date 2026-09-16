import { networkInterfaces } from "os";
import type { NextConfig } from "next";

// The dev server is often opened via a forwarded/LAN URL (VS Code port
// forwarding, another device on the network) rather than localhost. Next.js
// blocks cross-origin requests to dev-only resources (_next/*, HMR) by
// default, which silently breaks every client component — including the
// map, which has no server-rendered fallback since it's ssr:false, so it
// just sits on "Loading map…" forever with no visible error.
//
// A hardcoded LAN IP goes stale the moment the machine joins a different
// network (this has already happened once), so it's read from the OS at
// startup instead.
function currentLanAddresses(): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const info of iface ?? []) {
      if (info.family === "IPv4" && !info.internal) addresses.push(info.address);
    }
  }
  return addresses;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", ...currentLanAddresses()],
};

export default nextConfig;
