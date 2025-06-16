import { ListenIndividual } from '../../fbs/web-rtc-transport/listen-individual';
import { ListenServer } from '../../fbs/web-rtc-transport/listen-server';
export declare enum Listen {
    NONE = 0,
    ListenIndividual = 1,
    ListenServer = 2
}
export declare function unionToListen(type: Listen, accessor: (obj: ListenIndividual | ListenServer) => ListenIndividual | ListenServer | null): ListenIndividual | ListenServer | null;
export declare function unionListToListen(type: Listen, accessor: (index: number, obj: ListenIndividual | ListenServer) => ListenIndividual | ListenServer | null, index: number): ListenIndividual | ListenServer | null;
//# sourceMappingURL=listen.d.ts.map