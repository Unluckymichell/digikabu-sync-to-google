export class Logging {
    constructor(public readonly lname: string) { }

    log = this._bound_log("log");
    warn = this._bound_log("warn");
    error = this._bound_log("error");

    private _bound_log(fn: "log" | "warn" | "error") {
        return (...stuff: any[]) => {
            stuff = [this.lname, ...stuff];
            console[fn](...stuff);
        }
    }

    errorAndLeave(message: any) {
        this.error(message);
        process.exit(1);
        return message;
    }

}