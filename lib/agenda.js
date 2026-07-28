// Agenda du jour via l'URL iCal privee de Google Agenda (lecture seule, sans OAuth).
import ical from "node-ical";

const TZ = "Europe/Paris";

function frTime(d) {
  return new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

// Retourne les evenements dont le debut tombe aujourd'hui (heure de Paris).
export async function todayAgenda(url) {
  const data = await ical.async.fromURL(url);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const events = [];

  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;

    // Evenements simples
    const s = new Date(ev.start);
    if (s >= start && s < end) {
      events.push({ time: ev.datetype === "date" ? "journée" : frTime(s), summary: ev.summary || "(sans titre)", location: ev.location || "" });
      continue;
    }

    // Evenements recurrents : expanser sur la journee
    if (ev.rrule) {
      const occ = ev.rrule.between(start, end, true);
      for (const o of occ) {
        // exclure les dates annulees
        const key = new Date(o).toISOString().slice(0, 10);
        if (ev.exdate && ev.exdate[key]) continue;
        events.push({ time: ev.datetype === "date" ? "journée" : frTime(o), summary: ev.summary || "(sans titre)", location: ev.location || "" });
      }
    }
  }

  events.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return events;
}
