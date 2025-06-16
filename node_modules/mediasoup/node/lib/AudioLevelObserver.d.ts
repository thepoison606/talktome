import type { AudioLevelObserver, AudioLevelObserverEvents, AudioLevelObserverObserver } from './AudioLevelObserverTypes';
import type { RtpObserver } from './RtpObserverTypes';
import { RtpObserverImpl, RtpObserverConstructorOptions } from './RtpObserver';
import type { AppData } from './types';
type AudioLevelObserverConstructorOptions<AudioLevelObserverAppData> = RtpObserverConstructorOptions<AudioLevelObserverAppData>;
export declare class AudioLevelObserverImpl<AudioLevelObserverAppData extends AppData = AppData> extends RtpObserverImpl<AudioLevelObserverAppData, AudioLevelObserverEvents, AudioLevelObserverObserver> implements RtpObserver, AudioLevelObserver {
    constructor(options: AudioLevelObserverConstructorOptions<AudioLevelObserverAppData>);
    get type(): 'audiolevel';
    get observer(): AudioLevelObserverObserver;
    private handleWorkerNotifications;
    private handleListenerError;
}
export {};
//# sourceMappingURL=AudioLevelObserver.d.ts.map