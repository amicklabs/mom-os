import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/providers";
import { SetupPage } from "@/components/setup-page";
import { Shell } from "@/components/shell";
import { missingEnv } from "@/lib/env";
import "./globals.css";

// Read the environment per request so a missing key shows the setup page
// instead of a build-time crash.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "MomOS", template: "%s - MomOS" },
  description: "Admin for MomOS",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const missing = missingEnv();
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full font-sans">
        {missing.length > 0 ? (
          <SetupPage missing={missing} />
        ) : (
          <ClerkProvider>
            <ConvexClientProvider url={process.env.NEXT_PUBLIC_CONVEX_URL!}>
              <Shell>{children}</Shell>
            </ConvexClientProvider>
          </ClerkProvider>
        )}
      </body>
    </html>
  );
}
