import { EnhancedEventEmitter } from './enhancedEvents';
import type { Channel } from './Channel';
import type { WebRtcServer, WebRtcServerDump, WebRtcServerEvents, WebRtcServerObserver } from './WebRtcServerTypes';
import type { WebRtcTransport } from './WebRtcTransportTypes';
import type { AppData } from './types';
type WebRtcServerInternal = {
    webRtcServerId: string;
};
export declare class WebRtcServerImpl<WebRtcServerAppData extends AppData = AppData> extends EnhancedEventEmitter<WebRtcServerEvents> implements WebRtcServer {
    #private;
    constructor({ internal, channel, appData, }: {
        internal: WebRtcServerInternal;
        channel: Channel;
        appData?: WebRtcServerAppData;
    });
    get id(): string;
    get closed(): boolean;
    get appData(): WebRtcServerAppData;
    set appData(appData: WebRtcServerAppData);
    get observer(): WebRtcServerObserver;
    /**
     * Just for testing purposes.
     */
    get webRtcTransportsForTesting(): Map<string, WebRtcTransport>;
    close(): void;
    workerClosed(): void;
    dump(): Promise<WebRtcServerDump>;
    handleWebRtcTransport(webRtcTransport: WebRtcTransport): void;
    private handleListenerError;
}
export {};
//# sourceMappingURL=WebRtcServer.d.ts.map