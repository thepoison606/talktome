import type { DirectTransport, DirectTransportDump, DirectTransportStat, DirectTransportEvents, DirectTransportObserver } from './DirectTransportTypes';
import type { Transport, BaseTransportDump } from './TransportTypes';
import { TransportImpl, TransportConstructorOptions } from './Transport';
import type { SctpParameters } from './sctpParametersTypes';
import type { AppData } from './types';
import * as FbsDirectTransport from './fbs/direct-transport';
type DirectTransportConstructorOptions<DirectTransportAppData> = TransportConstructorOptions<DirectTransportAppData> & {
    data: DirectTransportData;
};
export type DirectTransportData = {
    sctpParameters?: SctpParameters;
};
export declare class DirectTransportImpl<DirectTransportAppData extends AppData = AppData> extends TransportImpl<DirectTransportAppData, DirectTransportEvents, DirectTransportObserver> implements Transport, DirectTransport {
    #private;
    constructor(options: DirectTransportConstructorOptions<DirectTransportAppData>);
    get type(): 'direct';
    get observer(): DirectTransportObserver;
    close(): void;
    routerClosed(): void;
    dump(): Promise<DirectTransportDump>;
    getStats(): Promise<DirectTransportStat[]>;
    connect(): Promise<void>;
    setMaxIncomingBitrate(bitrate: number): Promise<void>;
    setMaxOutgoingBitrate(bitrate: number): Promise<void>;
    setMinOutgoingBitrate(bitrate: number): Promise<void>;
    sendRtcp(rtcpPacket: Buffer): void;
    private handleWorkerNotifications;
    private handleListenerError;
}
export declare function parseDirectTransportDumpResponse(binary: FbsDirectTransport.DumpResponse): BaseTransportDump;
export {};
//# sourceMappingURL=DirectTransport.d.ts.map