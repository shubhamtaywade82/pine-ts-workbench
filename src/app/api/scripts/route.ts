import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { SavedScript } from "@/lib/script-library";

interface ScriptRow {
  id: string;
  name: string;
  kind: string;
  versions: string;
  isFavorite: boolean;
  openedAt: number;
  settings: string | null;
}

const toScript = (row: ScriptRow): SavedScript => ({
  id: row.id,
  name: row.name,
  kind: row.kind as "indicator" | "strategy",
  versions: JSON.parse(row.versions),
  isFavorite: Boolean(row.isFavorite),
  openedAt: Number(row.openedAt),
  settings: row.settings ? JSON.parse(row.settings) : undefined,
});

export async function GET() {
  try {
    const rows = await db.savedScript.findMany({ orderBy: { openedAt: "desc" } });
    return NextResponse.json({ ok: true, scripts: rows.map(toScript) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), scripts: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SavedScript;
    const data = {
      name: body.name,
      kind: body.kind,
      versions: JSON.stringify(body.versions),
      isFavorite: body.isFavorite ?? false,
      openedAt: body.openedAt ?? Date.now(),
      settings: body.settings ? JSON.stringify(body.settings) : null,
    };
    const row = await db.savedScript.upsert({
      where: { id: body.id },
      update: data,
      create: { id: body.id, ...data },
    });
    return NextResponse.json({ ok: true, script: toScript(row) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    await db.savedScript.delete({ where: { id } }).catch(() => null);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
