import * as flatbuffers from 'flatbuffers';
export declare class BitrateByLayer implements flatbuffers.IUnpackableObject<BitrateByLayerT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): BitrateByLayer;
    static getRootAsBitrateByLayer(bb: flatbuffers.ByteBuffer, obj?: BitrateByLayer): BitrateByLayer;
    static getSizePrefixedRootAsBitrateByLayer(bb: flatbuffers.ByteBuffer, obj?: BitrateByLayer): BitrateByLayer;
    layer(): string | null;
    layer(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    bitrate(): number;
    static startBitrateByLayer(builder: flatbuffers.Builder): void;
    static addLayer(builder: flatbuffers.Builder, layerOffset: flatbuffers.Offset): void;
    static addBitrate(builder: flatbuffers.Builder, bitrate: number): void;
    static endBitrateByLayer(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createBitrateByLayer(builder: flatbuffers.Builder, layerOffset: flatbuffers.Offset, bitrate: number): flatbuffers.Offset;
    unpack(): BitrateByLayerT;
    unpackTo(_o: BitrateByLayerT): void;
}
export declare class BitrateByLayerT implements flatbuffers.IGeneratedObject {
    layer: string | Uint8Array | null;
    bitrate: number;
    constructor(layer?: string | Uint8Array | null, bitrate?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=bitrate-by-layer.d.ts.map