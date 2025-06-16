import type { PipeTransport, PipeConsumerOptions, PipeTransportDump, PipeTransportStat, PipeTransportEvents, PipeTransportObserver } from './PipeTransportTypes';
import type { Transport, TransportTuple, SctpState } from './TransportTypes';
import { TransportImpl, TransportConstructorOptions } from './Transport';
import type { Consumer } from './ConsumerTypes';
import type { SctpParameters } from './sctpParametersTypes';
import type { SrtpParameters } from './srtpParametersTypes';
import type { AppData } from './types';
import * as FbsPipeTransport from './fbs/pipe-transport';
type PipeTransportConstructorOptions<PipeTransportAppData> = TransportConstructorOptions<PipeTransportAppData> & {
    data: PipeTransportData;
};
export type PipeTransportData = {
    tuple: TransportTuple;
    sctpParameters?: SctpParameters;
    sctpState?: SctpState;
    rtx: boolean;
    srtpParameters?: SrtpParameters;
};
export declare class PipeTransportImpl<PipeTransportAppData extends AppData = AppData> extends TransportImpl<PipeTransportAppData, PipeTransportEvents, PipeTransportObserver> implements Transport, PipeTransport {
    #private;
    constructor(options: PipeTransportConstructorOptions<PipeTransportAppData>);
    get type(): 'pipe';
    get observer(): PipeTransportObserver;
    get tuple(): TransportTuple;
    get sctpParameters(): SctpParameters | undefined;
    get sctpState(): SctpState | undefined;
    get srtpParameters(): SrtpParameters | undefined;
    close(): void;
    routerClosed(): void;
    dump(): Promise<PipeTransportDump>;
    getStats(): Promise<PipeTransportStat[]>;
    connect({ ip, port, srtpParameters, }: {
        ip: string;
        port: number;
        srtpParameters?: SrtpParameters;
    }): Promise<void>;
    consume<ConsumerAppData extends AppData = AppData>({ producerId, appData, }: PipeConsumerOptions<ConsumerAppData>): Promise<Consumer<ConsumerAppData>>;
    private handleWorkerNotifications;
    private handleListenerError;
}
export declare function parsePipeTransportDumpResponse(binary: FbsPipeTransport.DumpResponse): PipeTransportDump;
export {};
//# sourceMappingURL=PipeTransport.d.ts.map