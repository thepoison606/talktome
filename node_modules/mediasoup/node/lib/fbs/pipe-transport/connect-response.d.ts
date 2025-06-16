import * as flatbuffers from 'flatbuffers';
import { Tuple, TupleT } from '../../fbs/transport/tuple';
export declare class ConnectResponse implements flatbuffers.IUnpackableObject<ConnectResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConnectResponse;
    static getRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    static getSizePrefixedRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    tuple(obj?: Tuple): Tuple | null;
    static startConnectResponse(builder: flatbuffers.Builder): void;
    static addTuple(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): void;
    static endConnectResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createConnectResponse(builder: flatbuffers.Builder, tupleOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ConnectResponseT;
    unpackTo(_o: ConnectResponseT): void;
}
export declare class ConnectResponseT implements flatbuffers.IGeneratedObject {
    tuple: TupleT | null;
    constructor(tuple?: TupleT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=connect-response.d.ts.map