import "dotenv/config";
import { calendar_v3 } from 'googleapis';
import schedule from "node-schedule";
import process from 'node:process';
import { DigiKabuAPI } from "./DigiKabuAPI";
import { AppENV } from "./AppENV";
import { GoogleCalendarManager } from "./GoogleAPI";
import { promiseBatch } from "./util";
import { Syncer } from "./Syncer";

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

  // Run all syncers full sync sequentially
  await promiseBatch(
    1, syncers.map(syncer => () => syncer.syncAll())
  );
  
  // Run quick syncs every 2 hours from 6am to 6pm Mon-Fri
  const job1 = schedule.scheduleJob('0 6-18/2 * * 1-5', async () => {
    await promiseBatch(
      1, syncers.map(syncer => () => syncer.quickSync())
    );
  });
  
  // Run full syncs every night at 1 AM Mon-Fri
  const job2 = schedule.scheduleJob('0 1 * * 1-5', async () => {
    await promiseBatch(
      1, syncers.map(syncer => () => syncer.syncAll())
    );
  });
}

main();