import * as flatbuffers from 'flatbuffers';
import { Stats, StatsT } from '../../fbs/transport/stats';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
import { DtlsState } from '../../fbs/web-rtc-transport/dtls-state';
import { IceRole } from '../../fbs/web-rtc-transport/ice-role';
import { IceState } from '../../fbs/web-rtc-transport/ice-state';
export declare class GetStatsResponse implements flatbuffers.IUnpackableObject<GetStatsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): GetStatsResponse;
    static getRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    static getSizePrefixedRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    base(obj?: Stats): Stats | null;
    iceRole(): IceRole;
    iceState(): IceState;
    iceSelectedTuple(obj?: Tuple): Tuple | null;
    dtlsState(): DtlsState;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addIceRole(builder: flatbuffers.Builder, iceRole: IceRole): void;
    static addIceState(builder: flatbuffers.Builder, iceState: IceState): void;
    static addIceSelectedTuple(builder: flatbuffers.Builder, iceSelectedTupleOffset: flatbuffers.Offset): void;
    static addDtlsState(builder: flatbuffers.Builder, dtlsState: DtlsState): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    iceRole: IceRole;
    iceState: IceState;
    iceSelectedTuple: TupleT | null;
    dtlsState: DtlsState;
    constructor(base?: StatsT | null, iceRole?: IceRole, iceState?: IceState, iceSelectedTuple?: TupleT | null, dtlsState?: DtlsState);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map