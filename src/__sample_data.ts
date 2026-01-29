import { DigiKabu_Date, DigiKabuAPI } from "./DigiKabuAPI";
import { writeFile } from "fs/promises";

const api = new DigiKabuAPI("schlegem", "Moorlie622$");

const week: DigiKabu_Date = [
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
];

(async () => {
    await writeFile("./__get_stundenplan.json", JSON.stringify(
        await api.get_stundenplan(week, 5)
    ), { encoding: "utf8" });
    
    await writeFile("./__get_schulaufgaben.json", JSON.stringify(
        await api.get_schulaufgaben(week[1])
    ), { encoding: "utf8" });

    await writeFile("./__get_termine.json", JSON.stringify(
        await api.get_termine()
    ), { encoding: "utf8" });
})();

