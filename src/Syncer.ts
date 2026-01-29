import { calendar_v3 } from "googleapis";
import * as z from "zod";
import { DigiKabuAPI, Z_DigiKabu_EventEntery_Array, Z_DigiKabu_PlanEntery_Array } from "./DigiKabuAPI";
import { GoogleCalendarManager } from "./GoogleAPI";
import { Logging } from "./Logging";

/**
 * Stundenzeiten Mapping (Stunden-Nr. -> Startzeit in HH:MM)
 */
const STUNDEN_ZEITEN: Record<number, string> = {
  1: "08:30",
  2: "09:15",
  [2.5]: "10:00",
  3: "10:15",
  4: "11:00",
  5: "11:45",
  6: "12:30",
  7: "13:15",
  8: "14:00",
  9: "14:45",
  10: "15:30",
  11: "16:15",
  12: "17:00"
};

export class Syncer extends Logging {

  constructor(
    private googleCalendarManager: GoogleCalendarManager,
    private googleCalendar: calendar_v3.Schema$Calendar,
    private digiKabuAPI: DigiKabuAPI
  ) {
    super(`Syncer-${digiKabuAPI.getUser()}`);
  }

  /**
   * Synchronisiert den Stundenplan mit Google Calendar
   * Holt Daten für X Wochen ab der kommenden Montag
   */
  async syncStundenplanWeeks(weeksToSync: number): Promise<void> {
    try {
      if (!this.googleCalendar.id) {
        this.error(`Calendar ${this.googleCalendar.summary} does not have an id`);
        return;
      }

      // Berechne den Montag der aktuellen Woche
      const monday = this.getCurrentWeekMonday();

      // Hole Stundenplan für 2 Wochen
      for (let week = 0; week < weeksToSync; week++) {
        try {
          const weekDate = new Date(monday);
          weekDate.setDate(weekDate.getDate() + week * 7);

          const weekEndDate = new Date(weekDate);
          weekEndDate.setDate(weekEndDate.getDate() + 6);

          this.log(`Fetching stundenplan for week starting ${weekDate.toLocaleDateString()}`);

          const stundenplan = await this.digiKabuAPI.get_stundenplan(
            [weekDate.getFullYear(), weekDate.getMonth() + 1, weekDate.getDate()],
            7
          );

          await this.syncStundenplanToCalendar(
            this.googleCalendarManager.getCalendar(),
            this.googleCalendar.id,
            weekDate,
            weekEndDate,
            stundenplan
          );

          this.log(`Successfully synced week starting ${weekDate.toLocaleDateString()}`);
        } catch (err) {
          const weekDate = new Date(monday);
          weekDate.setDate(weekDate.getDate() + week * 7);
          this.error(`Failed to fetch week from ${weekDate.toLocaleDateString()}`);
          this.error(err);
        }
      }
    } catch (err) {
      this.error(`Error during weekly sync: ${err}`);
    }
  }

  /**
   * Synchronisiert Termin-Einträge (Klausuren, Events) mit Google Calendar
   */
  async syncTermine(): Promise<void> {
    try {
      if (!this.googleCalendar.id) {
        this.error(`Calendar ${this.googleCalendar.summary} does not have an id`);
        return;
      }

      this.log("Fetching termine from DigiKabu");
      const termine = await this.digiKabuAPI.get_termine();

      await this.syncTermineToCalendar(
        this.googleCalendarManager.getCalendar(),
        this.googleCalendar.id,
        termine
      );

      this.log("Successfully synced termine");
    } catch (err) {
      this.error(`Failed to sync termine: ${err}`);
    }
  }

  /**
   * Synchronisiert den Stundenplan nur für x Tage ab heute
   */
  async syncStundenplanDays(daysToSync: number): Promise<void> {
    try {
      if (!this.googleCalendar.id) {
        this.error(`Calendar ${this.googleCalendar.summary} does not have an id`);
        return;
      }

      // Heute und morgen
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + daysToSync - 1);

      this.log(`Fetching stundenplan for today (${today.toLocaleDateString()}) and tomorrow (${tomorrow.toLocaleDateString()})`);

      const stundenplan = await this.digiKabuAPI.get_stundenplan(
        [today.getFullYear(), today.getMonth() + 1, today.getDate()],
        daysToSync
      );

      await this.syncStundenplanToCalendar(
        this.googleCalendarManager.getCalendar(),
        this.googleCalendar.id,
        today,
        tomorrow,
        stundenplan
      );

      this.log(`Successfully synced stundenplan for today and tomorrow`);
    } catch (err) {
      this.error(`Failed to sync stundenplan for today and tomorrow: ${err}`);
    }
  }

  /**
   * Führt alle Synchronisationen durch
   */
  async syncAll(): Promise<void> {
    this.log("Starting full sync");
    await this.syncStundenplanWeeks(2);
    await this.syncTermine();
    this.log("Full sync completed");
  }

  /**
   * Schnelle Synchronisation für heute und morgen
   */
  async quickSync(): Promise<void> {
    this.log("Starting quick sync");
    await this.syncStundenplanDays(2);
    this.log("Quick sync completed");
  }

  /**
   * Synchronisiert Stundenplan mit Google Calendar
   * Erstellt neue Events, aktualisiert bestehende und löscht verwaiste Events
   */
  private async syncStundenplanToCalendar(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    startDate: Date,
    endDate: Date,
    stundenplan: z.infer<typeof Z_DigiKabu_PlanEntery_Array>
  ): Promise<void> {
    // Hole alle Events dieser Woche aus dem Kalender

    // Berechne den Beginn der Woche (Montag 00:00:00)
    const weekStart = new Date(startDate);
    weekStart.setHours(0, 0, 0, 0);

    // Berechne das Ende der Woche (Sonntag 23:59:59)
    const weekEnd = new Date(endDate);
    weekEnd.setHours(23, 59, 59, 999);

    const res = await calendar.events.list({
      calendarId,
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const existingEvents = res.data.items ?? [];

    // Erstelle Index für schnellen Zugriff
    // Key: stundenplan-datum+anfstd+endstd+gruppe
    const eventMap = new Map<string, calendar_v3.Schema$Event>();
    for (const ev of existingEvents) {
      const key = ev.extendedProperties?.private?.["syncKey"];
      if (key?.startsWith("stundenplan-")) eventMap.set(key, ev);
    }

    // Verarbeite neue/aktualisierte Stunden
    for (const eintrag of stundenplan) {
      const { datum, anfStd, endStd, lehrer, uFachBez, raumLongtext, gruppe } = eintrag;

      // Datum umwandeln [year, month, day] -> Date
      const baseDate = new Date(datum[0], datum[1] - 1, datum[2]);

      // Start/Endzeit finden
      const startIso = this.toDateTimeIso(baseDate, STUNDEN_ZEITEN[anfStd]!);
      const endIso = this.toDateTimeIso(
        baseDate,
        STUNDEN_ZEITEN[endStd + 0.5] ?? STUNDEN_ZEITEN[endStd + 1]!
      );

      const datumStr = `${datum[2]}.${datum[1]}.${datum[0]}`;
      const key = `stundenplan-${datumStr}_${anfStd}_${endStd}_${gruppe}`;
      const title = lehrer
        ? `${uFachBez} - ${lehrer} (${raumLongtext}, ${gruppe})`
        : `ENTFÄLLT ${uFachBez} (${raumLongtext}, ${gruppe})`;

      const existing = eventMap.get(key);

      if (!existing) {
        // Neuer Termin
        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: title,
            start: { dateTime: startIso },
            end: { dateTime: endIso },
            location: raumLongtext,
            colorId: lehrer ? "10" : "11", // Blau normal, Rot für Entfall
            extendedProperties: { private: { syncKey: key } },
          },
        });
        this.log(`Neuer Termin erstellt: ${title}`);
      } else {
        // Termin existiert bereits -> prüfe auf Änderungen
        const oldTitle = existing.summary ?? "";
        if (oldTitle !== title) {
          const notes =
            (existing.description ?? "") +
            `\n[ÄNDERUNG am ${new Date().toLocaleString()}] Vorher: ${oldTitle}`;
          await calendar.events.patch({
            calendarId,
            eventId: existing.id!,
            requestBody: {
              summary: title,
              description: notes,
              location: raumLongtext,
              colorId: lehrer ? "6" : "11", // Orange für Änderung
            },
          });
          this.log(`Termin aktualisiert: ${title}`);
        } else {
          this.log(`Termin noch in Ordnung: ${title}`);
        }
        eventMap.delete(key); // Markiere als verarbeitet
      }
    }

    // Lösche Events, die keinen Eintrag mehr haben
    for (const remainingEv of Array.from(eventMap.values())) {
      if (remainingEv.id) {
        await calendar.events.delete({
          calendarId,
          eventId: remainingEv.id,
        });
        this.log(`Verwaisten Termin gelöscht: ${remainingEv.summary}`);
      }
    }
  }

  /**
   * Synchronisiert Termine (Events, Ferien, etc.) mit Google Calendar
   */
  private async syncTermineToCalendar(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    termine: z.infer<typeof Z_DigiKabu_EventEntery_Array>
  ): Promise<void> {
    // Bestimme den Datumsbereich aus den Termine-Daten
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const termin of termine) {
      const { datumVon, datumBis } = termin;
      const vonDate = new Date(datumVon[0], datumVon[1] - 1, datumVon[2]);
      const bisDate = new Date(datumBis[0], datumBis[1] - 1, datumBis[2]);

      if (!minDate || vonDate < minDate) minDate = vonDate;
      if (!maxDate || bisDate > maxDate) maxDate = bisDate;
    }

    // Falls keine Termine vorhanden sind, verlasse die Funktion
    if (!minDate || !maxDate) {
      this.log("No termine to sync");
      return;
    }

    // Erweitere den Bereich um einen Tag für Sicherheit
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 2);

    const res = await calendar.events.list({
      calendarId,
      timeMin: minDate.toISOString(),
      timeMax: maxDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const existingEvents = res.data.items ?? [];

    // Erstelle Index für schnellen Zugriff
    // Key: termine-{id}
    const eventMap = new Map<string, calendar_v3.Schema$Event>();
    for (const ev of existingEvents) {
      const key = ev.extendedProperties?.private?.["syncKey"];
      if (key?.startsWith("termine-")) eventMap.set(key, ev);
    }

    // Verarbeite Termine
    for (const termin of termine) {
      const { id, datumVon, datumBis, hinweis } = termin;
      
      // Konvertiere [year, month, day] zu Date
      const startDate = new Date(datumVon[0], datumVon[1] - 1, datumVon[2]);
      const endDate = new Date(datumBis[0], datumBis[1] - 1, datumBis[2]);
      
      // Für Ganztagstermine: endDate auf den nächsten Tag setzen
      endDate.setDate(endDate.getDate() + 1);

      const key = `termine-${id}`;
      const existing = eventMap.get(key);

      if (!existing) {
        // Neuer Termin
        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: hinweis,
            start: { dateTime: this.toDateTimeIso(startDate, "00:00") },
            end: { dateTime: this.toDateTimeIso(endDate, "00:00") },
            colorId: "11", // Rot für neue Termine
            extendedProperties: { private: { syncKey: key } },
          },
        });
        this.log(`Neuer Termin erstellt: ${hinweis}`);
      } else {
        // Termin existiert bereits -> prüfe auf Änderungen
        const oldTitle = existing.summary ?? "";
        if (oldTitle !== hinweis) {
          const notes =
            (existing.description ?? "") +
            `\n[ÄNDERUNG am ${new Date().toLocaleString()}] Vorher: ${oldTitle}`;
          await calendar.events.patch({
            calendarId,
            eventId: existing.id!,
            requestBody: {
              summary: hinweis,
              description: notes,
              colorId: "11", // Rot beibehalten
            },
          });
          this.log(`Termin aktualisiert: ${hinweis}`);
        } else {
          this.log(`Termin noch in Ordnung: ${hinweis}`);
        }
        eventMap.delete(key); // Markiere als verarbeitet
      }
    }

    // Lösche Events, die keinen Eintrag mehr haben
    for (const remainingEv of Array.from(eventMap.values())) {
      if (remainingEv.id) {
        await calendar.events.delete({
          calendarId,
          eventId: remainingEv.id,
        });
        this.log(`Verwaisten Termin gelöscht: ${remainingEv.summary}`);
      }
    }

    this.log(`Successfully synced ${termine.length} termine to calendar`);
  }

  /**
   * Konvertiert Datum und Uhrzeit zu ISO-String
   */
  private toDateTimeIso(date: Date, time: string): string {
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(hh!, mm, 0, 0);
    return d.toISOString();
  }

  /**
   * Berechnet den Montag der aktuellen Woche (oder heute, wenn heute Montag ist)
   */
  private getCurrentWeekMonday(): Date {
    const monday = new Date();
    const day = monday.getDay();
    const diff = monday.getDate() - day + (day === 0 ? -6 : 1); // Adj. für Sonntag
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

}