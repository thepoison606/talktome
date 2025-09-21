import * as flatbuffers from 'flatbuffers';
export declare class DegradeRequest implements flatbuffers.IUnpackableObject<DegradeRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DegradeRequest;
    static getRootAsDegradeRequest(bb: flatbuffers.ByteBuffer, obj?: DegradeRequest): DegradeRequest;
    static getSizePrefixedRootAsDegradeRequest(bb: flatbuffers.ByteBuffer, obj?: DegradeRequest): DegradeRequest;
    durationMs(): number;
    maxDelayMs(): number;
    delayPercent(): number;
    lossPercent(): number;
    static startDegradeRequest(builder: flatbuffers.Builder): void;
    static addDurationMs(builder: flatbuffers.Builder, durationMs: number): void;
    static addMaxDelayMs(builder: flatbuffers.Builder, maxDelayMs: number): void;
    static addDelayPercent(builder: flatbuffers.Builder, delayPercent: number): void;
    static addLossPercent(builder: flatbuffers.Builder, lossPercent: number): void;
    static endDegradeRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDegradeRequest(builder: flatbuffers.Builder, durationMs: number, maxDelayMs: number, delayPercent: number, lossPercent: number): flatbuffers.Offset;
    unpack(): DegradeRequestT;
    unpackTo(_o: DegradeRequestT): void;
}
export declare class DegradeRequestT implements flatbuffers.IGeneratedObject {
    durationMs: number;
    maxDelayMs: number;
    delayPercent: number;
    lossPercent: number;
    constructor(durationMs?: number, maxDelayMs?: number, delayPercent?: number, lossPercent?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=degrade-request.d.ts.map