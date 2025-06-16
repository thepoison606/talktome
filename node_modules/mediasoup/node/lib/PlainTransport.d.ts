import type { PlainTransport, PlainTransportDump, PlainTransportStat, PlainTransportEvents, PlainTransportObserver } from './PlainTransportTypes';
import type { Transport, TransportTuple, SctpState } from './TransportTypes';
import { TransportImpl, TransportConstructorOptions } from './Transport';
import type { SctpParameters } from './sctpParametersTypes';
import type { SrtpParameters } from './srtpParametersTypes';
import type { AppData } from './types';
import * as FbsPlainTransport from './fbs/plain-transport';
type PlainTransportConstructorOptions<PlainTransportAppData> = TransportConstructorOptions<PlainTransportAppData> & {
    data: PlainTransportData;
};
export type PlainTransportData = {
    rtcpMux?: boolean;
    comedia?: boolean;
    tuple: TransportTuple;
    rtcpTuple?: TransportTuple;
    sctpParameters?: SctpParameters;
    sctpState?: SctpState;
    srtpParameters?: SrtpParameters;
};
export declare class PlainTransportImpl<PlainTransportAppData extends AppData = AppData> extends TransportImpl<PlainTransportAppData, PlainTransportEvents, PlainTransportObserver> implements Transport, PlainTransport {
    #private;
    constructor(options: PlainTransportConstructorOptions<PlainTransportAppData>);
    get type(): 'plain';
    get observer(): PlainTransportObserver;
    get tuple(): TransportTuple;
    get rtcpTuple(): TransportTuple | undefined;
    get sctpParameters(): SctpParameters | undefined;
    get sctpState(): SctpState | undefined;
    get srtpParameters(): SrtpParameters | undefined;
    close(): void;
    routerClosed(): void;
    dump(): Promise<PlainTransportDump>;
    getStats(): Promise<PlainTransportStat[]>;
    connect({ ip, port, rtcpPort, srtpParameters, }: {
        ip?: string;
        port?: number;
        rtcpPort?: number;
        srtpParameters?: SrtpParameters;
    }): Promise<void>;
    private handleWorkerNotifications;
    private handleListenerError;
}
export declare function parsePlainTransportDumpResponse(binary: FbsPlainTransport.DumpResponse): PlainTransportDump;
export {};
//# sourceMappingURL=PlainTransport.d.ts.map