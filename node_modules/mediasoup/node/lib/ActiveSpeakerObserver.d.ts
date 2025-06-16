import type { ActiveSpeakerObserver, ActiveSpeakerObserverEvents, ActiveSpeakerObserverObserver } from './ActiveSpeakerObserverTypes';
import type { RtpObserver } from './RtpObserverTypes';
import { RtpObserverImpl, RtpObserverConstructorOptions } from './RtpObserver';
import type { AppData } from './types';
type RtpObserverObserverConstructorOptions<ActiveSpeakerObserverAppData> = RtpObserverConstructorOptions<ActiveSpeakerObserverAppData>;
export declare class ActiveSpeakerObserverImpl<ActiveSpeakerObserverAppData extends AppData = AppData> extends RtpObserverImpl<ActiveSpeakerObserverAppData, ActiveSpeakerObserverEvents, ActiveSpeakerObserverObserver> implements RtpObserver, ActiveSpeakerObserver {
    constructor(options: RtpObserverObserverConstructorOptions<ActiveSpeakerObserverAppData>);
    get type(): 'activespeaker';
    get observer(): ActiveSpeakerObserverObserver;
    private handleWorkerNotifications;
    private handleListenerError;
}
export {};
//# sourceMappingURL=ActiveSpeakerObserver.d.ts.map