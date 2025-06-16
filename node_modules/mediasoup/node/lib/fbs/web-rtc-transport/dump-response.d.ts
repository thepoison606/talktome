import * as flatbuffers from 'flatbuffers';
import { Dump, DumpT } from '../../fbs/transport/dump';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
import { DtlsParameters, DtlsParametersT } from '../../fbs/web-rtc-transport/dtls-parameters';
import { DtlsState } from '../../fbs/web-rtc-transport/dtls-state';
import { IceCandidate, IceCandidateT } from '../../fbs/web-rtc-transport/ice-candidate';
import { IceParameters, IceParametersT } from '../../fbs/web-rtc-transport/ice-parameters';
import { IceRole } from '../../fbs/web-rtc-transport/ice-role';
import { IceState } from '../../fbs/web-rtc-transport/ice-state';
export declare class DumpResponse implements flatbuffers.IUnpackableObject<DumpResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DumpResponse;
    static getRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    static getSizePrefixedRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    base(obj?: Dump): Dump | null;
    iceRole(): IceRole;
    iceParameters(obj?: IceParameters): IceParameters | null;
    iceCandidates(index: number, obj?: IceCandidate): IceCandidate | null;
    iceCandidatesLength(): number;
    iceState(): IceState;
    iceSelectedTuple(obj?: Tuple): Tuple | null;
    dtlsParameters(obj?: DtlsParameters): DtlsParameters | null;
    dtlsState(): DtlsState;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addIceRole(builder: flatbuffers.Builder, iceRole: IceRole): void;
    static addIceParameters(builder: flatbuffers.Builder, iceParametersOffset: flatbuffers.Offset): void;
    static addIceCandidates(builder: flatbuffers.Builder, iceCandidatesOffset: flatbuffers.Offset): void;
    static createIceCandidatesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startIceCandidatesVector(builder: flatbuffers.Builder, numElems: number): void;
    static addIceState(builder: flatbuffers.Builder, iceState: IceState): void;
    static addIceSelectedTuple(builder: flatbuffers.Builder, iceSelectedTupleOffset: flatbuffers.Offset): void;
    static addDtlsParameters(builder: flatbuffers.Builder, dtlsParametersOffset: flatbuffers.Offset): void;
    static addDtlsState(builder: flatbuffers.Builder, dtlsState: DtlsState): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    base: DumpT | null;
    iceRole: IceRole;
    iceParameters: IceParametersT | null;
    iceCandidates: (IceCandidateT)[];
    iceState: IceState;
    iceSelectedTuple: TupleT | null;
    dtlsParameters: DtlsParametersT | null;
    dtlsState: DtlsState;
    constructor(base?: DumpT | null, iceRole?: IceRole, iceParameters?: IceParametersT | null, iceCandidates?: (IceCandidateT)[], iceState?: IceState, iceSelectedTuple?: TupleT | null, dtlsParameters?: DtlsParametersT | null, dtlsState?: DtlsState);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map