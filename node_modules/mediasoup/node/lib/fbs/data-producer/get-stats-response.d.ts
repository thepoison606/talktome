import * as flatbuffers from 'flatbuffers';
export declare class GetStatsResponse implements flatbuffers.IUnpackableObject<GetStatsResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): GetStatsResponse;
    static getRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    static getSizePrefixedRootAsGetStatsResponse(bb: flatbuffers.ByteBuffer, obj?: GetStatsResponse): GetStatsResponse;
    timestamp(): bigint;
    label(): string | null;
    label(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    protocol(): string | null;
    protocol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    messagesReceived(): bigint;
    bytesReceived(): bigint;
    bufferedAmount(): number;
    static startGetStatsResponse(builder: flatbuffers.Builder): void;
    static addTimestamp(builder: flatbuffers.Builder, timestamp: bigint): void;
    static addLabel(builder: flatbuffers.Builder, labelOffset: flatbuffers.Offset): void;
    static addProtocol(builder: flatbuffers.Builder, protocolOffset: flatbuffers.Offset): void;
    static addMessagesReceived(builder: flatbuffers.Builder, messagesReceived: bigint): void;
    static addBytesReceived(builder: flatbuffers.Builder, bytesReceived: bigint): void;
    static addBufferedAmount(builder: flatbuffers.Builder, bufferedAmount: number): void;
    static endGetStatsResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createGetStatsResponse(builder: flatbuffers.Builder, timestamp: bigint, labelOffset: flatbuffers.Offset, protocolOffset: flatbuffers.Offset, messagesReceived: bigint, bytesReceived: bigint, bufferedAmount: number): flatbuffers.Offset;
    unpack(): GetStatsResponseT;
    unpackTo(_o: GetStatsResponseT): void;
}
export declare class GetStatsResponseT implements flatbuffers.IGeneratedObject {
    timestamp: bigint;
    label: string | Uint8Array | null;
    protocol: string | Uint8Array | null;
    messagesReceived: bigint;
    bytesReceived: bigint;
    bufferedAmount: number;
    constructor(timestamp?: bigint, label?: string | Uint8Array | null, protocol?: string | Uint8Array | null, messagesReceived?: bigint, bytesReceived?: bigint, bufferedAmount?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=get-stats-response.d.ts.map