import * as flatbuffers from 'flatbuffers';
import { SrtpParameters, SrtpParametersT } from '../../fbs/srtp-parameters/srtp-parameters';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class ConnectResponse implements flatbuffers.IUnpackableObject<ConnectResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConnectResponse;
    static getRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    static getSizePrefixedRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    tuple(obj?: Tuple): Tuple | null;
    rtcpTuple(obj?: Tuple): Tuple | null;
    srtpParameters(obj?: SrtpParameters): SrtpParameters | null;
    static startConnectResponse(builder: flatbuffers.Builder): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static addRtcpTuple(builder: flatbuffers.Builder, rtcpTupleOffset: flatbuffers.Offset): void;
    static addSrtpParameters(builder: flatbuffers.Builder, srtpParametersOffset: flatbuffers.Offset): void;
    static endConnectResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): ConnectResponseT;
    unpackTo(_o: ConnectResponseT): void;
}
export declare class ConnectResponseT implements flatbuffers.IGeneratedObject {
    tuple: TupleT | null;
    rtcpTuple: TupleT | null;
    srtpParameters: SrtpParametersT | null;
    constructor(tuple?: TupleT | null, rtcpTuple?: TupleT | null, srtpParameters?: SrtpParametersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=connect-response.d.ts.map