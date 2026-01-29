import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logging } from './Logging';

type user = string;
type pass = string;
type email = string;

export class AppENV extends Logging {
    GOOGLE_SECRET_FILE: string;
    DIGI_GOOLE_SYNCS: {[key: `${user}:${pass}`]: email[]}

    constructor(public proc: typeof process) {

        super("AppENV");

        const GOOGLE_SECRET_FILE = proc.env["GOOGLE_SECRET_FILE"];

        if(typeof GOOGLE_SECRET_FILE != "string")
            throw this.errorAndLeave("Please specify GOOGLE_SECRET_FILE in env");
        
        const GOOGLE_SECRET_FILE_RESOLVED = resolve(GOOGLE_SECRET_FILE)

        if(!existsSync(GOOGLE_SECRET_FILE_RESOLVED))
            throw this.errorAndLeave("GOOGLE_SECRET_FILE does not exist on drive");

        this.GOOGLE_SECRET_FILE = GOOGLE_SECRET_FILE_RESOLVED;

        const DIGI_GOOLE_SYNCS = proc.env["DIGI_GOOLE_SYNCS"];

        if(typeof DIGI_GOOLE_SYNCS != "string")
            throw this.errorAndLeave("Please specify DIGI_GOOLE_SYNCS in env as json matching type: {[key: `${user}:${pass}`]: email[]}");
        
        let DIGI_GOOLE_SYNCS_PARSED: typeof this.DIGI_GOOLE_SYNCS;
        try {
            DIGI_GOOLE_SYNCS_PARSED = JSON.parse(DIGI_GOOLE_SYNCS);
        } catch(err) {
            throw this.errorAndLeave("JSON error in DIGI_GOOLE_SYNCS:\n" + err);
        }

        if(typeof DIGI_GOOLE_SYNCS_PARSED != "object" || Array.isArray(DIGI_GOOLE_SYNCS_PARSED)) throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Has to be JSON Object matching this type: {[key: `${user}:${pass}`]: email[]}");

        Object.entries(DIGI_GOOLE_SYNCS_PARSED).forEach(([digiLogin, googleEmails]) => {
            if(typeof digiLogin != "string") throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Keys have to be strings of digikabu user:password");
            if(!digiLogin.match(/.+:.+/)) throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Key has to match user:password");
            if(!Array.isArray(googleEmails)) throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Values need to bee arrays of google emails as strings");
            if(!googleEmails.every(v => typeof v == "string")) throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Values need to bee arrays of google emails as strings");
            if(!googleEmails.every(v => v.match(/[a-zA-Z0-9]+(@gmail\.com)|(@googlemail\.com)/))) throw this.errorAndLeave("Error in DIGI_GOOLE_SYNCS:\n" + "Values need to bee arrays of google emails as strings!\n Emails need to be gmail.com or googlemail.com");
        });

        this.DIGI_GOOLE_SYNCS = DIGI_GOOLE_SYNCS_PARSED;
    }

}