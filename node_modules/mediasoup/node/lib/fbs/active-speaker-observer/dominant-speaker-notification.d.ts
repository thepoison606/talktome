import * as flatbuffers from 'flatbuffers';
export declare class DominantSpeakerNotification implements flatbuffers.IUnpackableObject<DominantSpeakerNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DominantSpeakerNotification;
    static getRootAsDominantSpeakerNotification(bb: flatbuffers.ByteBuffer, obj?: DominantSpeakerNotification): DominantSpeakerNotification;
    static getSizePrefixedRootAsDominantSpeakerNotification(bb: flatbuffers.ByteBuffer, obj?: DominantSpeakerNotification): DominantSpeakerNotification;
    producerId(): string | null;
    producerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startDominantSpeakerNotification(builder: flatbuffers.Builder): void;
    static addProducerId(builder: flatbuffers.Builder, producerIdOffset: flatbuffers.Offset): void;
    static endDominantSpeakerNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDominantSpeakerNotification(builder: flatbuffers.Builder, producerIdOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): DominantSpeakerNotificationT;
    unpackTo(_o: DominantSpeakerNotificationT): void;
}
export declare class DominantSpeakerNotificationT implements flatbuffers.IGeneratedObject {
    producerId: string | Uint8Array | null;
    constructor(producerId?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dominant-speaker-notification.d.ts.map