import { createServerFn } from "@tanstack/react-start";

export type PlaceHit = { label: string; lat: number; lng: number };

function asHit(lat: unknown, lng: unknown, label: string): PlaceHit | null {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  return { label: label.trim() || "Result", lat: y, lng: x };
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((query: string) => query.trim().slice(0, 140))
  .handler(async ({ data }): Promise<PlaceHit[]> => {
    const query = data;
    if (query.length < 2) return [];
    const headers = { accept: "application/json", "user-agent": "Trazado/1.0" };
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`, { headers });
      if (res.ok) {
        const body = (await res.json()) as {
          features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, string> }[];
        };
        const rows = (body.features ?? [])
          .map((feature) => {
            const [lng, lat] = feature.geometry?.coordinates ?? [];
            const props = feature.properties ?? {};
            const street = [props.housenumber, props.street].filter(Boolean).join(" ");
            const label = [street || props.name, props.city, props.state, props.country].filter(Boolean).join(", ");
            return asHit(lat, lng, label);
          })
          .filter((row): row is PlaceHit => row !== null);
        if (rows.length > 0) return rows;
      }
    } catch {
      /* try the next directory */
    }
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
      { headers },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
    return body
      .map((row) => asHit(row.lat, row.lon, row.display_name ?? ""))
      .filter((row): row is PlaceHit => row !== null);
  });
