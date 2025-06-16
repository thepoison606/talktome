import * as flatbuffers from 'flatbuffers';
import { BweType } from '../../fbs/transport/bwe-type';
export declare class BweTraceInfo implements flatbuffers.IUnpackableObject<BweTraceInfoT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): BweTraceInfo;
    static getRootAsBweTraceInfo(bb: flatbuffers.ByteBuffer, obj?: BweTraceInfo): BweTraceInfo;
    static getSizePrefixedRootAsBweTraceInfo(bb: flatbuffers.ByteBuffer, obj?: BweTraceInfo): BweTraceInfo;
    bweType(): BweType;
    desiredBitrate(): number;
    effectiveDesiredBitrate(): number;
    minBitrate(): number;
    maxBitrate(): number;
    startBitrate(): number;
    maxPaddingBitrate(): number;
    availableBitrate(): number;
    static startBweTraceInfo(builder: flatbuffers.Builder): void;
    static addBweType(builder: flatbuffers.Builder, bweType: BweType): void;
    static addDesiredBitrate(builder: flatbuffers.Builder, desiredBitrate: number): void;
    static addEffectiveDesiredBitrate(builder: flatbuffers.Builder, effectiveDesiredBitrate: number): void;
    static addMinBitrate(builder: flatbuffers.Builder, minBitrate: number): void;
    static addMaxBitrate(builder: flatbuffers.Builder, maxBitrate: number): void;
    static addStartBitrate(builder: flatbuffers.Builder, startBitrate: number): void;
    static addMaxPaddingBitrate(builder: flatbuffers.Builder, maxPaddingBitrate: number): void;
    static addAvailableBitrate(builder: flatbuffers.Builder, availableBitrate: number): void;
    static endBweTraceInfo(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createBweTraceInfo(builder: flatbuffers.Builder, bweType: BweType, desiredBitrate: number, effectiveDesiredBitrate: number, minBitrate: number, maxBitrate: number, startBitrate: number, maxPaddingBitrate: number, availableBitrate: number): flatbuffers.Offset;
    unpack(): BweTraceInfoT;
    unpackTo(_o: BweTraceInfoT): void;
}
export declare class BweTraceInfoT implements flatbuffers.IGeneratedObject {
    bweType: BweType;
    desiredBitrate: number;
    effectiveDesiredBitrate: number;
    minBitrate: number;
    maxBitrate: number;
    startBitrate: number;
    maxPaddingBitrate: number;
    availableBitrate: number;
    constructor(bweType?: BweType, desiredBitrate?: number, effectiveDesiredBitrate?: number, minBitrate?: number, maxBitrate?: number, startBitrate?: number, maxPaddingBitrate?: number, availableBitrate?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=bwe-trace-info.d.ts.map