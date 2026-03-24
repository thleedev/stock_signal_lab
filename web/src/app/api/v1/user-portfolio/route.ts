import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_portfolios")
    .select("id, name, sort_order, is_default, created_at")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ portfolios: data });
}

export async function POST(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { name } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "포트 이름이 필요합니다" }, { status: 400 });
  }

  // 소프트 삭제된 동일 이름 포트가 있으면 복원
  const { data: existing } = await supabase
    .from("user_portfolios")
    .select("id, deleted_at")
    .eq("name", name.trim())
    .single();

  if (existing && existing.deleted_at) {
    const { data, error } = await supabase
      .from("user_portfolios")
      .update({ deleted_at: null })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ portfolio: data, restored: true });
  }

  // 새 포트 생성
  const { data: maxOrder } = await supabase
    .from("user_portfolios")
    .select("sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();

  const nextOrder = (maxOrder?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("user_portfolios")
    .insert({ name: name.trim(), sort_order: nextOrder })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 존재하는 포트 이름입니다" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ portfolio: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();

  // 일괄 순서 변경: { orders: [{id, sort_order}] }
  if (body.orders && Array.isArray(body.orders)) {
    const results = await Promise.all(
      body.orders.map((o: { id: number; sort_order: number }) =>
        supabase
          .from("user_portfolios")
          .update({ sort_order: o.sort_order })
          .eq("id", o.id)
          .is("deleted_at", null)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // 개별 수정: { id, name?, sort_order? }
  const { id, name, sort_order } = body;

  if (!id) {
    return NextResponse.json({ error: "포트 ID가 필요합니다" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sort_order !== undefined) updates.sort_order = sort_order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 항목이 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_portfolios")
    .update(updates)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "포트를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ portfolio: data });
}

export async function DELETE(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "포트 ID가 필요합니다" }, { status: 400 });
  }

  const { data: portfolio } = await supabase
    .from("user_portfolios")
    .select("is_default")
    .eq("id", id)
    .single();

  if (portfolio?.is_default) {
    return NextResponse.json({ error: "기본 포트는 삭제할 수 없습니다" }, { status: 403 });
  }

  const { error } = await supabase
    .from("user_portfolios")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
