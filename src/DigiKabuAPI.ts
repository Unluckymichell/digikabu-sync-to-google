import * as z from "zod";
import { Result } from "./util";
import { Logging } from "./Logging";
import { JSDOM } from "jsdom";

/** [year, month, day] */
export type DigiKabu_Date = [number, number, number];
/** [hours, minutes, seconds] */
export type DigiKabu_Time = [number, number, number];
export type DigiKabu_DateTime = [DigiKabu_Date, DigiKabu_Time];

export const Z_DigiKabu_PlanEntery = z.object({
    datum: z.string()
        .regex(/[0-9]{1,2}\.[0-9]{1,2}\.[0-9]+/) // "29.09.2025"
        .transform(str => str
            .split(".")
            .reverse() as unknown as DigiKabu_Date
        ),
    anfStd: z.number(),
    endStd: z.number(),
    lehrer: z.nullish(z.string()),
    uFachBez: z.string(),
    raumLongtext: z.string(),
    gruppe: z.string(),
});
export const Z_DigiKabu_PlanEntery_Array = z.array(Z_DigiKabu_PlanEntery);
//export type DigiKabu_PlanEntery = z.infer<typeof Z_DigiKabu_PlanEntery>;

export const Z_DigiKabu_EventEntery = z.object({
    /** Non uniqe for some reason! */
    id: z.number(),
    /** datumVon == datumBis -> Full Day */
    datumVon: z.string()
        .regex(/[0-9]+(-[0-9]{1,2}){2}T[0-9]{1,2}(:[0-9]{1,2}){2}/) // '2026-01-09T00:00:00'
        .transform(str => {
            // Remove the time portion (T00:00:00)
            const datePart = str.split("T")[0]!;
            return datePart.split("-").map(Number) as unknown as DigiKabu_Date;
        }),
    datumBis: z.string()
        .regex(/[0-9]+(-[0-9]{1,2}){2}T[0-9]{1,2}(:[0-9]{1,2}){2}/) // '2026-01-09T00:00:00'
        .transform(str => {
            // Remove the time portion (T00:00:00)
            const datePart = str.split("T")[0]!;
            return datePart.split("-").map(Number) as unknown as DigiKabu_Date;
        }),
    hinweis: z.string(),
    /** Seems to be the same all the time */
    art: z.number(),
    idabteilung: z.number(),
    /** Was allways null in Testing */
    klasse: z.nullable(z.string())
});
export const Z_DigiKabu_EventEntery_Array = z.array(Z_DigiKabu_EventEntery);
//export type DigiKabu_EventEntery = z.infer<typeof Z_DigiKabu_EventEntery>;

export const Z_DigiKabu_TestEntery = z.object({
    date: z.string()
        .regex(/[0-9]{1,2}\.[0-9]{1,2}\.[0-9]+/) // '20.11.2025' 
        .transform(str => str.split(".").reverse() as unknown as DigiKabu_Date),
    info: z.string()
});
export const Z_DigiKabu_TestEntery_Array = z.array(Z_DigiKabu_TestEntery);
//export type DigiKabu_TestEntery = z.infer<typeof Z_DigiKabu_TestEntery>;

export class DigiKabuAPI extends Logging {
    private authToken: string | null = null;

    constructor(
        private user: string,
        private pass: string
    ) {
        super("DigiKabuAPI");
    }

    async post_authenticate() {
        this.log(".post_authenticate");

        const url = new URL("https://www.digikabu.de/api/authenticate");

        const result = await this.fetch_post(url, z.string(), {
            userName: this.user,
            password: this.pass,
        }, true);

        if (result.error) {
            switch (result.error.type) {
                case "status": throw new Error("Status was not 200! Status code: " + result.error.code);
                case "json": throw new Error("Error while parsing response as json:\nResponse: " + result.error.rawText + "\nCatched error: " + result.error.err);
                case "zod": throw new Error("Error while verifying object:\nObject: " + result.error.rawObject + "\nCatched error: " + result.error.err);
            }
        } else {
            this.authToken = result.value;
        }
    }

    async get_stundenplan(datum: DigiKabu_Date, anzahl: number) {
        this.log(`.get_stundenplan("${datum}", ${anzahl})`);
        const url = new URL("https://digikabu.de/api/stundenplan");
        url.searchParams.set("datum", datum.map(n => n.toString().padStart(2, "0")).join("-"));
        url.searchParams.set("anzahl", anzahl.toString());

        let result = await this.fetch_get(url, Z_DigiKabu_PlanEntery_Array, "json");
        if (result.error?.type == "status" && result.error.code == 401) {
            this.warn(`.get_stundenplan("${datum}", ${anzahl}) -> Failed unauthorised!, Login + Retry`);
            await this.post_authenticate();
            result = await this.fetch_get(url, Z_DigiKabu_PlanEntery_Array, "json");
        }

        return this.handle_fetch_errors(result);
    }

    async get_termine(idAbteilung: number = 1) {
        this.log(`.get_termine(${idAbteilung}`);
        const url = new URL("https://digikabu.de/api/termine");
        url.searchParams.set("idAbteilung", idAbteilung.toString());

        let result = await this.fetch_get(url, Z_DigiKabu_EventEntery_Array, "json");
        if (result.error?.type == "status" && result.error.code == 401) {
            this.warn(`.get_termine(${idAbteilung}) -> Failed unauthorised!, Login + Retry`);
            await this.post_authenticate();
            result = await this.fetch_get(url, Z_DigiKabu_EventEntery_Array, "json");
        }

        return this.handle_fetch_errors(result);
    }

    async get_schulaufgaben(monat?: number) {
        this.log(`.get_schulaufgaben(${monat}`);
        const url = new URL("https://digikabu.de/api/termine/schulaufgaben");
        if (monat) url.searchParams.set("monat", monat.toString());

        let result = await this.fetch_get(url, Z_DigiKabu_TestEntery_Array, "json");
        if (result.error?.type == "status" && result.error.code == 401) {
            this.warn(`.get_schulaufgaben(${monat}) -> Failed unauthorised!, Login + Retry`);
            await this.post_authenticate();
            result = await this.fetch_get(url, Z_DigiKabu_TestEntery_Array, "json");
        }

        return this.handle_fetch_errors(result);
    }

    async handle_fetch_errors<t>(result: Result<t, { type: "status", code: number } | { type: "json", err: any, rawText: string } | { type: "html", err: any, rawText: string } | { type: "zod", err: any, rawObject: any }>) {
        if (result.error) {
            switch (result.error.type) {
                case "status": throw new Error("Status was not 200! Status code: " + result.error.code);
                case "json": throw new Error("Error while parsing response as json:\nResponse: " + result.error.rawText + "\nCatched error: " + result.error.err);
                case "zod": throw new Error("Error while verifying object:\nObject: " + result.error.rawObject + "\nCatched error: " + result.error.err);
                case "html": throw new Error("Error while parsing text as html:\nObject: " + result.error.rawText + "\nCatched error: " + result.error.err);
            }
        } else {
            return result.value;
        }
    }

    async fetch_get<
        t extends z.ZodType,
        rt extends "json" | "html"
    >(
        url: URL,
        Z_Type: rt extends "json" ? t : null,
        rtype: rt
    ): Promise<Result<
        rt extends "json" ? z.infer<t> : JSDOM,
        { type: "status", code: number }
        | { type: rt, err: any, rawText: string }
        | { type: "zod", err: any, rawObject: any }
    >> {
        this.log(`.fetch_get(URL(${url.href}), Z_Type)`);
        const headers: { [key: string]: string } = {
            'accept': '*/*',
            'Content-Type': 'text/json',
        }

        if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

        const rawResp = await fetch(url, {
            headers,
            method: "GET"
        });

        if (rawResp.status != 200) return {
            error: {
                type: "status",
                code: rawResp.status
            }
        }

        if (rtype == "json") {

            let jsonResp: any = null;
            try {
                jsonResp = await rawResp.json();
            } catch (err) {
                return {
                    error: {
                        type: "json" as any,
                        err,
                        rawText: await rawResp.text()
                    }
                }
            }

            let resp: z.output<t>;
            try {
                resp = Z_Type?.parse(jsonResp) as z.output<t>;
            } catch (err) {
                return {
                    error: {
                        type: "zod",
                        err,
                        rawObject: jsonResp
                    }
                }
            }

            return {
                value: resp as any
            };

        } else {

            const text = await rawResp.text();
            let dom: JSDOM;
            try {
                 dom = new JSDOM(text, {
                    url: "https://example.org/",
                    referrer: "https://example.com/",
                    contentType: "text/html",
                    includeNodeLocations: false,
                    storageQuota: 10000000
                });
            } catch (err) {
                return {
                    error: {
                        type: "html" as any,
                        err,
                        rawText: text
                    }
                };
            }

            return {
                value: dom as any
            };

        }
    }

    async fetch_post<
        t extends z.ZodType,
        b extends string | Object
    >(url: URL, Z_Type: t, body: b, noLog = false): Promise<Result<
        z.infer<t>,
        { type: "status", code: number }
        | { type: "json", err: any, rawText: string }
        | { type: "zod", err: any, rawObject: any }
    >> {
        if (!noLog) this.log(`.fetch_post(URL(${url.href}), Z_Type, ${JSON.stringify(body)})`);
        const headers: { [key: string]: string } = {
            'accept': '*/*',
            'Content-Type': 'text/json',
        }

        if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

        const strBody = typeof body == "string" ? body : JSON.stringify(body);

        const rawResp = await fetch(url, {
            headers,
            body: strBody,
            method: "POST"
        });

        if (rawResp.status != 200) return {
            error: {
                type: "status",
                code: rawResp.status
            }
        }

        let jsonResp: any = null;
        try {
            jsonResp = await rawResp.json();
        } catch (err) {
            return {
                error: {
                    type: "json",
                    err,
                    rawText: await rawResp.text()
                }
            }
        }

        let resp: z.output<t>;
        try {
            resp = Z_Type.parse(jsonResp);
        } catch (err) {
            return {
                error: {
                    type: "zod",
                    err,
                    rawObject: jsonResp
                }
            }
        }

        return {
            value: resp
        };
    }

    getUser() {
        return this.user;
    }

    getAuthToken() {
        return this.authToken;
    }
}