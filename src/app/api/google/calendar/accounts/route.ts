import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Returns the caller's connected accounts and their calendars (RLS-scoped). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const [{ data: accounts }, { data: sources }] = await Promise.all([
    supabase.from("calendar_accounts").select("*").order("slot"),
    supabase.from("calendar_sources").select("*").order("summary"),
  ]);

  return NextResponse.json({ ok: true, accounts: accounts ?? [], sources: sources ?? [] });
}
