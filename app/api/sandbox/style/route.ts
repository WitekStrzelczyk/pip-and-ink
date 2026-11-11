import { houseStyle, setHouseStyle } from "@/lib/painter";

export const dynamic = "force-dynamic";

/** The illustration style used for every colour picture in the stories ("" = let GLM choose). */
export async function GET() {
  return Response.json({ color: houseStyle() });
}

export async function PUT(request: Request) {
  const body = await request.json();
  setHouseStyle(String(body.color ?? "").slice(0, 600));
  return Response.json({ color: houseStyle() });
}
