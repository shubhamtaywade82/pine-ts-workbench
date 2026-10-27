import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { SavedLayout } from "@/lib/saved-layouts";

interface LayoutRow {
  id: string;
  name: string;
  layout: number;
  cells: string;
}

const toLayout = (row: LayoutRow): SavedLayout => ({
  id: row.id,
  name: row.name,
  layout: row.layout,
  cells: JSON.parse(row.cells),
});

export async function GET() {
  try {
    const rows = await db.savedLayout.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ ok: true, layouts: rows.map(toLayout) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), layouts: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SavedLayout;
    const data = {
      name: body.name,
      layout: body.layout,
      cells: JSON.stringify(body.cells),
    };
    const row = await db.savedLayout.upsert({
      where: { id: body.id },
      update: data,
      create: { id: body.id, ...data },
    });
    return NextResponse.json({ ok: true, layout: toLayout(row) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    await db.savedLayout.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
