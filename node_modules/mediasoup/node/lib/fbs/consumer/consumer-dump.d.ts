import * as flatbuffers from 'flatbuffers';
import { BaseConsumerDump, BaseConsumerDumpT } from '../../fbs/consumer/base-consumer-dump';
import { Dump, DumpT } from '../../fbs/rtp-stream/dump';
export declare class ConsumerDump implements flatbuffers.IUnpackableObject<ConsumerDumpT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConsumerDump;
    static getRootAsConsumerDump(bb: flatbuffers.ByteBuffer, obj?: ConsumerDump): ConsumerDump;
    static getSizePrefixedRootAsConsumerDump(bb: flatbuffers.ByteBuffer, obj?: ConsumerDump): ConsumerDump;
    base(obj?: BaseConsumerDump): BaseConsumerDump | null;
    rtpStreams(index: number, obj?: Dump): Dump | null;
    rtpStreamsLength(): number;
    preferredSpatialLayer(): number | null;
    targetSpatialLayer(): number | null;
    currentSpatialLayer(): number | null;
    preferredTemporalLayer(): number | null;
    targetTemporalLayer(): number | null;
    currentTemporalLayer(): number | null;
    static startConsumerDump(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addRtpStreams(builder: flatbuffers.Builder, rtpStreamsOffset: flatbuffers.Offset): void;
    static createRtpStreamsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startRtpStreamsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addPreferredSpatialLayer(builder: flatbuffers.Builder, preferredSpatialLayer: number): void;
    static addTargetSpatialLayer(builder: flatbuffers.Builder, targetSpatialLayer: number): void;
    static addCurrentSpatialLayer(builder: flatbuffers.Builder, currentSpatialLayer: number): void;
    static addPreferredTemporalLayer(builder: flatbuffers.Builder, preferredTemporalLayer: number): void;
    static addTargetTemporalLayer(builder: flatbuffers.Builder, targetTemporalLayer: number): void;
    static addCurrentTemporalLayer(builder: flatbuffers.Builder, currentTemporalLayer: number): void;
    static endConsumerDump(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createConsumerDump(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset, rtpStreamsOffset: flatbuffers.Offset, preferredSpatialLayer: number | null, targetSpatialLayer: number | null, currentSpatialLayer: number | null, preferredTemporalLayer: number | null, targetTemporalLayer: number | null, currentTemporalLayer: number | null): flatbuffers.Offset;
    unpack(): ConsumerDumpT;
    unpackTo(_o: ConsumerDumpT): void;
}
export declare class ConsumerDumpT implements flatbuffers.IGeneratedObject {
    base: BaseConsumerDumpT | null;
    rtpStreams: (DumpT)[];
    preferredSpatialLayer: number | null;
    targetSpatialLayer: number | null;
    currentSpatialLayer: number | null;
    preferredTemporalLayer: number | null;
    targetTemporalLayer: number | null;
    currentTemporalLayer: number | null;
    constructor(base?: BaseConsumerDumpT | null, rtpStreams?: (DumpT)[], preferredSpatialLayer?: number | null, targetSpatialLayer?: number | null, currentSpatialLayer?: number | null, preferredTemporalLayer?: number | null, targetTemporalLayer?: number | null, currentTemporalLayer?: number | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=consumer-dump.d.ts.map