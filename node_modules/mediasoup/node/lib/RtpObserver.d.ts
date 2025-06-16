import { EnhancedEventEmitter } from './enhancedEvents';
import type { RtpObserverEvents, RtpObserverObserver } from './RtpObserverTypes';
import type { Channel } from './Channel';
import type { RouterInternal } from './Router';
import type { Producer } from './ProducerTypes';
import type { AppData } from './types';
export type RtpObserverConstructorOptions<RtpObserverAppData> = {
    internal: RtpObserverObserverInternal;
    channel: Channel;
    appData?: RtpObserverAppData;
    getProducerById: (producerId: string) => Producer | undefined;
};
type RtpObserverObserverInternal = RouterInternal & {
    rtpObserverId: string;
};
export declare abstract class RtpObserverImpl<RtpObserverAppData extends AppData = AppData, Events extends RtpObserverEvents = RtpObserverEvents, Observer extends RtpObserverObserver = RtpObserverObserver> extends EnhancedEventEmitter<Events> {
    #private;
    protected readonly internal: RtpObserverObserverInternal;
    protected readonly channel: Channel;
    protected readonly getProducerById: (producerId: string) => Producer | undefined;
    protected constructor({ internal, channel, appData, getProducerById, }: RtpObserverConstructorOptions<RtpObserverAppData>, observer: Observer);
    get id(): string;
    get closed(): boolean;
    get paused(): boolean;
    get appData(): RtpObserverAppData;
    set appData(appData: RtpObserverAppData);
    get observer(): Observer;
    close(): void;
    routerClosed(): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
    addProducer({ producerId }: {
        producerId: string;
    }): Promise<void>;
    removeProducer({ producerId }: {
        producerId: string;
    }): Promise<void>;
}
export {};
//# sourceMappingURL=RtpObserver.d.ts.map