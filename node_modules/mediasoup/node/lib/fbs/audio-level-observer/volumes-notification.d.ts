import * as flatbuffers from 'flatbuffers';
import { Volume, VolumeT } from '../../fbs/audio-level-observer/volume';
export declare class VolumesNotification implements flatbuffers.IUnpackableObject<VolumesNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): VolumesNotification;
    static getRootAsVolumesNotification(bb: flatbuffers.ByteBuffer, obj?: VolumesNotification): VolumesNotification;
    static getSizePrefixedRootAsVolumesNotification(bb: flatbuffers.ByteBuffer, obj?: VolumesNotification): VolumesNotification;
    volumes(index: number, obj?: Volume): Volume | null;
    volumesLength(): number;
    static startVolumesNotification(builder: flatbuffers.Builder): void;
    static addVolumes(builder: flatbuffers.Builder, volumesOffset: flatbuffers.Offset): void;
    static createVolumesVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startVolumesVector(builder: flatbuffers.Builder, numElems: number): void;
    static endVolumesNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createVolumesNotification(builder: flatbuffers.Builder, volumesOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): VolumesNotificationT;
    unpackTo(_o: VolumesNotificationT): void;
}
export declare class VolumesNotificationT implements flatbuffers.IGeneratedObject {
    volumes: (VolumeT)[];
    constructor(volumes?: (VolumeT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=volumes-notification.d.ts.map