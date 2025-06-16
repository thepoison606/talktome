import * as flatbuffers from 'flatbuffers';
export declare class SocketFlags implements flatbuffers.IUnpackableObject<SocketFlagsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SocketFlags;
    static getRootAsSocketFlags(bb: flatbuffers.ByteBuffer, obj?: SocketFlags): SocketFlags;
    static getSizePrefixedRootAsSocketFlags(bb: flatbuffers.ByteBuffer, obj?: SocketFlags): SocketFlags;
    ipv6Only(): boolean;
    udpReusePort(): boolean;
    static startSocketFlags(builder: flatbuffers.Builder): void;
    static addIpv6Only(builder: flatbuffers.Builder, ipv6Only: boolean): void;
    static addUdpReusePort(builder: flatbuffers.Builder, udpReusePort: boolean): void;
    static endSocketFlags(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSocketFlags(builder: flatbuffers.Builder, ipv6Only: boolean, udpReusePort: boolean): flatbuffers.Offset;
    unpack(): SocketFlagsT;
    unpackTo(_o: SocketFlagsT): void;
}
export declare class SocketFlagsT implements flatbuffers.IGeneratedObject {
    ipv6Only: boolean;
    udpReusePort: boolean;
    constructor(ipv6Only?: boolean, udpReusePort?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=socket-flags.d.ts.map