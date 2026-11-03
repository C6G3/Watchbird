import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, isDemo } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isDemo) (await cookies()).delete(DEMO_COOKIE);
  else await (await createSupabaseServer()).auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
