import "dotenv/config";
import { calendar_v3 } from 'googleapis';
import schedule from "node-schedule";
import process from 'node:process';
import { DigiKabuAPI } from "./DigiKabuAPI";
import { AppENV } from "./AppENV";
import { GoogleCalendarManager } from "./GoogleAPI";
import { promiseBatch } from "./util";
import { Syncer } from "./Syncer";

async function setupCalendars(googleCalendarManager: GoogleCalendarManager, appENV: AppENV) {
  // Ensure all calendars exist, pulling out calendar_v3 objects
  const userToCalendarMap: { user_pass: string, cal: calendar_v3.Schema$Calendar, emails: string[] }[] = [];
  await promiseBatch(3,
    Object.entries(appENV.DIGI_GOOLE_SYNCS).map(([user_pass, emails]) =>
      async () => {
        const [user] = user_pass.split(":", 2);
        if (!user) return;
        userToCalendarMap.push({
          user_pass,
          cal: await googleCalendarManager.enschureCalendar("DigiKabu-" + user),
          emails
        });
      }
    )
  );

  // Ensure all users of the calendar have rights
  await promiseBatch(3,
    userToCalendarMap.map(({ cal, emails }) =>
      async () => await googleCalendarManager.enschureCalendarShared(cal, emails)
    )
  );

  // Create Digikabu API instances for each user
  const loginToCalendarMap: { digiApi: DigiKabuAPI, cal: calendar_v3.Schema$Calendar, emails: string[] }[] = [];
  await promiseBatch(
    3,
    userToCalendarMap.map(({ user_pass, cal, emails }) =>
      async () => {
        const [user, pass] = user_pass.split(":", 2);
        if (!user || !pass) {
          console.error("Invalid digiKabu login in config: " + user_pass);
          return;
        }
        const digiApi = new DigiKabuAPI(user, pass);
        try {
          await digiApi.post_authenticate();
        } catch (e) {
          console.error("Failed to authenticate digiKabu user " + user + ": " + e);
          return;
        }
        loginToCalendarMap.push({ digiApi, cal, emails });
      }
    ));

  // Instantiate a syncer for each login/calendar
  const syncers = loginToCalendarMap.map(({ digiApi, cal, emails }) => new Syncer(
    googleCalendarManager,
    cal,
    digiApi
  ));

  return syncers;
}

async function main() {

  // Pull and verify app config
  const appENV = new AppENV(process);

  // Login google
  const googleCalendarManager = new GoogleCalendarManager();
  if (appENV.GOOGLE_SECRET_JSON) {
    await googleCalendarManager.authenticateFromJson(appENV.GOOGLE_SECRET_JSON);
  } else if (appENV.GOOGLE_SECRET_FILE) {
    await googleCalendarManager.authenticate(appENV.GOOGLE_SECRET_FILE);
  } else {
    throw new Error("Missing GOOGLE_SECRET_FILE or GOOGLE_SECRET_JSON");
  }

  // First setup of calendars and digiKabu API instances
  let syncers = await setupCalendars(googleCalendarManager, appENV);

  // Run all syncers full sync sequentially
  await promiseBatch(
    1, syncers.map(syncer => () => syncer.syncAll())
  );
  
  // Run weekly resetup job every Sunday at 12:00 to catch any changes in config or calendar setup
  const job_resetup = schedule.scheduleJob('12 0 * * 0', async () => {
    console.log("Running weekly resetup job...");
    // Replace Syncers with newly setup ones
    syncers = await setupCalendars(googleCalendarManager, appENV);
  });

  // Run quick syncs every 2 hours from 6am to 6pm Mon-Fri (when changes are most likely to happen)
  const job_quick_sync = schedule.scheduleJob('0/30 6-18 * * 1-5', async () => {
    console.log("Running quick sync job...");
    await promiseBatch(
      1, syncers.map(syncer => () => syncer.quickSync())
    );
  });

  // Run full syncs every night at 1 AM Mon-Fri to ensure data consistency and catch any missed changes
  const job_full_sync = schedule.scheduleJob('0 1 * * 1-5', async () => {
    console.log("Running full sync job...");
    await promiseBatch(
      1, syncers.map(syncer => () => syncer.syncAll())
    );
  });
}

main();