import * as flatbuffers from 'flatbuffers';
import { BitrateByLayer, BitrateByLayerT } from '../../fbs/rtp-stream/bitrate-by-layer';
import { Stats, StatsT } from '../../fbs/rtp-stream/stats';
export declare class RecvStats implements flatbuffers.IUnpackableObject<RecvStatsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RecvStats;
    static getRootAsRecvStats(bb: flatbuffers.ByteBuffer, obj?: RecvStats): RecvStats;
    static getSizePrefixedRootAsRecvStats(bb: flatbuffers.ByteBuffer, obj?: RecvStats): RecvStats;
    base(obj?: Stats): Stats | null;
    jitter(): number;
    packetCount(): bigint;
    byteCount(): bigint;
    bitrate(): number;
    bitrateByLayer(index: number, obj?: BitrateByLayer): BitrateByLayer | null;
    bitrateByLayerLength(): number;
    static startRecvStats(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addJitter(builder: flatbuffers.Builder, jitter: number): void;
    static addPacketCount(builder: flatbuffers.Builder, packetCount: bigint): void;
    static addByteCount(builder: flatbuffers.Builder, byteCount: bigint): void;
    static addBitrate(builder: flatbuffers.Builder, bitrate: number): void;
    static addBitrateByLayer(builder: flatbuffers.Builder, bitrateByLayerOffset: flatbuffers.Offset): void;
    static createBitrateByLayerVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startBitrateByLayerVector(builder: flatbuffers.Builder, numElems: number): void;
    static endRecvStats(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRecvStats(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset, jitter: number, packetCount: bigint, byteCount: bigint, bitrate: number, bitrateByLayerOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RecvStatsT;
    unpackTo(_o: RecvStatsT): void;
}
export declare class RecvStatsT implements flatbuffers.IGeneratedObject {
    base: StatsT | null;
    jitter: number;
    packetCount: bigint;
    byteCount: bigint;
    bitrate: number;
    bitrateByLayer: (BitrateByLayerT)[];
    constructor(base?: StatsT | null, jitter?: number, packetCount?: bigint, byteCount?: bigint, bitrate?: number, bitrateByLayer?: (BitrateByLayerT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=recv-stats.d.ts.map