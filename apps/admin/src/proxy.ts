import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { clerkConfigured } from "./lib/env";

// Without Clerk keys the app shows its setup page, so the proxy steps aside
// instead of throwing.
const clerk = clerkMiddleware();

export default function proxy(...args: Parameters<typeof clerk>) {
  if (!clerkConfigured()) return NextResponse.next();
  return clerk(...args);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    "/(api|trpc)(.*)",
  ],
};
