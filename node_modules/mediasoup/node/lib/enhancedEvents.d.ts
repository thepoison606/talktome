import { EventEmitter } from 'node:events';
type Events = Record<string, any[]>;
export declare class EnhancedEventEmitter<E extends Events = Events, BuiltInEvents extends Events = {
    listenererror: [keyof E, Error];
}, E2 extends Events = E & BuiltInEvents> extends EventEmitter {
    constructor();
    emit<K extends keyof E2 & string>(eventName: K, ...args: E2[K]): boolean;
    /**
     * Special addition to the EventEmitter API.
     */
    safeEmit<K extends keyof E2 & string>(eventName: K, ...args: E2[K]): boolean;
    on<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    off<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    addListener<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    prependListener<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    once<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    prependOnceListener<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    removeListener<K extends keyof E2 & string>(eventName: K, listener: (...args: E2[K]) => void): this;
    removeAllListeners<K extends keyof E2 & string>(eventName?: K): this;
    listenerCount<K extends keyof E2 & string>(eventName: K): number;
    listeners<K extends keyof E2 & string>(eventName: K): Function[];
    rawListeners<K extends keyof E2 & string>(eventName: K): Function[];
}
/**
 * TypeScript version of events.once():
 *   https://nodejs.org/api/events.html#eventsonceemitter-name-options
 *
 * Usage example:
 * ```ts
 * await enhancedOnce<ConsumerEvents>(videoConsumer, 'producerpause');
 * ```
 */
export declare function enhancedOnce<E extends Events = Events>(emmiter: EnhancedEventEmitter<E>, eventName: keyof E & string, options?: any): Promise<any[]>;
export {};
//# sourceMappingURL=enhancedEvents.d.ts.map