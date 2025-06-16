import * as flatbuffers from 'flatbuffers';
export declare class RtcpParameters implements flatbuffers.IUnpackableObject<RtcpParametersT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtcpParameters;
    static getRootAsRtcpParameters(bb: flatbuffers.ByteBuffer, obj?: RtcpParameters): RtcpParameters;
    static getSizePrefixedRootAsRtcpParameters(bb: flatbuffers.ByteBuffer, obj?: RtcpParameters): RtcpParameters;
    cname(): string | null;
    cname(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    reducedSize(): boolean;
    static startRtcpParameters(builder: flatbuffers.Builder): void;
    static addCname(builder: flatbuffers.Builder, cnameOffset: flatbuffers.Offset): void;
    static addReducedSize(builder: flatbuffers.Builder, reducedSize: boolean): void;
    static endRtcpParameters(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtcpParameters(builder: flatbuffers.Builder, cnameOffset: flatbuffers.Offset, reducedSize: boolean): flatbuffers.Offset;
    unpack(): RtcpParametersT;
    unpackTo(_o: RtcpParametersT): void;
}
export declare class RtcpParametersT implements flatbuffers.IGeneratedObject {
    cname: string | Uint8Array | null;
    reducedSize: boolean;
    constructor(cname?: string | Uint8Array | null, reducedSize?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtcp-parameters.d.ts.map