"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const debug_1 = require("debug");
const APP_NAME = 'mediasoup';
class Logger {
    static debugLogEmitter;
    static warnLogEmitter;
    static errorLogEmitter;
    #debug;
    #warn;
    #error;
    static setEmitters(debugLogEmitter, warnLogEmitter, errorLogEmitter) {
        Logger.debugLogEmitter = debugLogEmitter;
        Logger.warnLogEmitter = warnLogEmitter;
        Logger.errorLogEmitter = errorLogEmitter;
    }
    constructor(prefix) {
        if (prefix) {
            this.#debug = (0, debug_1.default)(`${APP_NAME}:${prefix}`);
            this.#warn = (0, debug_1.default)(`${APP_NAME}:WARN:${prefix}`);
            this.#error = (0, debug_1.default)(`${APP_NAME}:ERROR:${prefix}`);
        }
        else {
            this.#debug = (0, debug_1.default)(APP_NAME);
            this.#warn = (0, debug_1.default)(`${APP_NAME}:WARN`);
            this.#error = (0, debug_1.default)(`${APP_NAME}:ERROR`);
        }
        /* eslint-disable no-console */
        this.#debug.log = console.info.bind(console);
        this.#warn.log = console.warn.bind(console);
        this.#error.log = console.error.bind(console);
        /* eslint-enable no-console */
    }
    debug(log) {
        this.#debug(log);
        Logger.debugLogEmitter?.safeEmit('debuglog', this.#debug.namespace, log);
    }
    warn(log) {
        this.#warn(log);
        Logger.warnLogEmitter?.safeEmit('warnlog', this.#warn.namespace, log);
    }
    error(log, error) {
        this.#error(log, error);
        Logger.errorLogEmitter?.safeEmit('errorlog', this.#error.namespace, log, error);
    }
}
exports.Logger = Logger;
