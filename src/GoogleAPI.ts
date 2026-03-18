import { Auth, calendar_v3, google } from 'googleapis';
import { resolve } from 'node:path';
import { Logging } from './Logging';

export class GoogleCalendarManager extends Logging {
    private auth: Auth.GoogleAuth | null = null;
    private gcal: calendar_v3.Calendar | null = null;

    constructor(private scopes = ['https://www.googleapis.com/auth/calendar']) {
        super("GoogleCalendarManager");
    }

    async authenticate(keyFilePath: string) {
        const keyFile = resolve(keyFilePath);

        this.log("Authenticating");
        const auth = new google.auth.GoogleAuth({
            scopes: this.scopes,
            keyFile: keyFile
        });

        this.auth = auth;

        if (!this.auth) throw "Not authenticated"

        this.log("Init google API");
        this.gcal = google.calendar({ version: "v3", auth: this.auth });
    }

    async authenticateFromJson(keyFileJson: string) {
        let credentials: Record<string, any>;
        try {
            credentials = JSON.parse(keyFileJson);
        } catch (err) {
            throw "Invalid GOOGLE_SECRET_JSON: " + err;
        }

        this.log("Authenticating (json)");
        const auth = new google.auth.GoogleAuth({
            scopes: this.scopes,
            credentials
        });

        this.auth = auth;

        if (!this.auth) throw "Not authenticated"

        this.log("Init google API");
        this.gcal = google.calendar({ version: "v3", auth: this.auth });
    }

    async enschureCalendar(name: string) {
        if (!this.gcal) throw "Not inititialised";

        this.log("Enschuring Calendar exists for", name);

        const existingCalendars = await this.gcal.calendarList.list();
        const foundCal = existingCalendars.data.items?.find(
            (c) => c.summary === name
        );

        if (foundCal) return foundCal;

        const newCal = await this.gcal.calendars.insert({
            requestBody: {
                summary: name,
                timeZone: "Europe/Berlin",
            },
        });

        if (newCal.status != 200) throw "Failed to create Calendar";

        return newCal.data;
    }

    async enschureCalendarShared(cal: calendar_v3.Schema$Calendar, mails: string[]) {
        if (!this.gcal) throw "Not inititialised";
        if (!cal.id) throw "Invalid Calendar, no id";

        this.log("Enschuring Calendar", cal.summary, " is shared to all users");

        const aclList = await this.gcal.acl.list({ calendarId: cal.id });
        if (aclList.status != 200) throw "Failed to create Calendar";

        const addToShared = mails.filter((ue) => !aclList.data.items?.some(
            (rule) => rule.scope?.type === "user" && rule.scope.value === ue
        ));

        for (const aue of addToShared) {
            this.log("Scharing calendar", cal.summary, "with", aue);
            await this.gcal.acl.insert({
                calendarId: cal.id,
                requestBody: {
                    role: "owner", // oder "writer"
                    scope: {
                        type: "user",
                        value: aue,
                    },
                },
            });
        }
    }

    getCalendar() {
        if(!this.gcal) throw "Not initialised";
        return this.gcal;
    }
}