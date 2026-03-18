import "dotenv/config";
import { DigiKabu_Date, DigiKabuAPI } from "./DigiKabuAPI";
import { writeFile } from "fs/promises";


const login = Object.keys(JSON.parse(process.env["DIGI_GOOLE_SYNCS"]!))[0]?.split(":") as [string, string] | undefined;
if (!login) throw "Add one login to the DIGI_GOOLE_SYNCS environment variable in the format: {\"username:password\": \"google_calendar_id\"}";
const api = new DigiKabuAPI(...login);

const week: DigiKabu_Date = [
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
];

(async () => {
    await writeFile("./__get_stundenplan.json", JSON.stringify(
        await api.get_stundenplan(week, 1)
    ), { encoding: "utf8" });

    await writeFile("./__get_schulaufgaben.json", JSON.stringify(
        await api.get_schulaufgaben(week[1])
    ), { encoding: "utf8" });

    await writeFile("./__get_termine.json", JSON.stringify(
        await api.get_termine()
    ), { encoding: "utf8" });
})();


