import * as flatbuffers from 'flatbuffers';
export declare class Volume implements flatbuffers.IUnpackableObject<VolumeT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Volume;
    static getRootAsVolume(bb: flatbuffers.ByteBuffer, obj?: Volume): Volume;
    static getSizePrefixedRootAsVolume(bb: flatbuffers.ByteBuffer, obj?: Volume): Volume;
    producerId(): string | null;
    producerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    volume(): number;
    static startVolume(builder: flatbuffers.Builder): void;
    static addProducerId(builder: flatbuffers.Builder, producerIdOffset: flatbuffers.Offset): void;
    static addVolume(builder: flatbuffers.Builder, volume: number): void;
    static endVolume(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createVolume(builder: flatbuffers.Builder, producerIdOffset: flatbuffers.Offset, volume: number): flatbuffers.Offset;
    unpack(): VolumeT;
    unpackTo(_o: VolumeT): void;
}
export declare class VolumeT implements flatbuffers.IGeneratedObject {
    producerId: string | Uint8Array | null;
    volume: number;
    constructor(producerId?: string | Uint8Array | null, volume?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=volume.d.ts.map