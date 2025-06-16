import * as flatbuffers from 'flatbuffers';
import { Protocol } from '../../fbs/transport/protocol';
export declare class Tuple implements flatbuffers.IUnpackableObject<TupleT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Tuple;
    static getRootAsTuple(bb: flatbuffers.ByteBuffer, obj?: Tuple): Tuple;
    static getSizePrefixedRootAsTuple(bb: flatbuffers.ByteBuffer, obj?: Tuple): Tuple;
    localAddress(): string | null;
    localAddress(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    localPort(): number;
    remoteIp(): string | null;
    remoteIp(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    remotePort(): number;
    protocol(): Protocol;
    static startTuple(builder: flatbuffers.Builder): void;
    static addLocalAddress(builder: flatbuffers.Builder, localAddressOffset: flatbuffers.Offset): void;
    static addLocalPort(builder: flatbuffers.Builder, localPort: number): void;
    static addRemoteIp(builder: flatbuffers.Builder, remoteIpOffset: flatbuffers.Offset): void;
    static addRemotePort(builder: flatbuffers.Builder, remotePort: number): void;
    static addProtocol(builder: flatbuffers.Builder, protocol: Protocol): void;
    static endTuple(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createTuple(builder: flatbuffers.Builder, localAddressOffset: flatbuffers.Offset, localPort: number, remoteIpOffset: flatbuffers.Offset, remotePort: number, protocol: Protocol): flatbuffers.Offset;
    unpack(): TupleT;
    unpackTo(_o: TupleT): void;
}
export declare class TupleT implements flatbuffers.IGeneratedObject {
    localAddress: string | Uint8Array | null;
    localPort: number;
    remoteIp: string | Uint8Array | null;
    remotePort: number;
    protocol: Protocol;
    constructor(localAddress?: string | Uint8Array | null, localPort?: number, remoteIp?: string | Uint8Array | null, remotePort?: number, protocol?: Protocol);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=tuple.d.ts.map