import type { WebRtcTransport, IceParameters, IceCandidate, DtlsParameters, IceState, DtlsState, WebRtcTransportDump, WebRtcTransportStat, WebRtcTransportEvents, WebRtcTransportObserver } from './WebRtcTransportTypes';
import type { Transport, TransportTuple, SctpState } from './TransportTypes';
import { TransportImpl, TransportConstructorOptions } from './Transport';
import type { SctpParameters } from './sctpParametersTypes';
import type { AppData } from './types';
import * as FbsWebRtcTransport from './fbs/web-rtc-transport';
type WebRtcTransportConstructorOptions<WebRtcTransportAppData> = TransportConstructorOptions<WebRtcTransportAppData> & {
    data: WebRtcTransportData;
};
export type WebRtcTransportData = {
    iceRole: 'controlled';
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    iceState: IceState;
    iceSelectedTuple?: TransportTuple;
    dtlsParameters: DtlsParameters;
    dtlsState: DtlsState;
    dtlsRemoteCert?: string;
    sctpParameters?: SctpParameters;
    sctpState?: SctpState;
};
export declare class WebRtcTransportImpl<WebRtcTransportAppData extends AppData = AppData> extends TransportImpl<WebRtcTransportAppData, WebRtcTransportEvents, WebRtcTransportObserver> implements Transport, WebRtcTransport {
    #private;
    constructor(options: WebRtcTransportConstructorOptions<WebRtcTransportAppData>);
    get type(): 'webrtc';
    get observer(): WebRtcTransportObserver;
    get iceRole(): 'controlled';
    get iceParameters(): IceParameters;
    get iceCandidates(): IceCandidate[];
    get iceState(): IceState;
    get iceSelectedTuple(): TransportTuple | undefined;
    get dtlsParameters(): DtlsParameters;
    get dtlsState(): DtlsState;
    get dtlsRemoteCert(): string | undefined;
    get sctpParameters(): SctpParameters | undefined;
    get sctpState(): SctpState | undefined;
    close(): void;
    routerClosed(): void;
    listenServerClosed(): void;
    dump(): Promise<WebRtcTransportDump>;
    getStats(): Promise<WebRtcTransportStat[]>;
    connect({ dtlsParameters, }: {
        dtlsParameters: DtlsParameters;
    }): Promise<void>;
    restartIce(): Promise<IceParameters>;
    private handleWorkerNotifications;
    private handleListenerError;
}
export declare function parseWebRtcTransportDumpResponse(binary: FbsWebRtcTransport.DumpResponse): WebRtcTransportDump;
export {};
//# sourceMappingURL=WebRtcTransport.d.ts.map