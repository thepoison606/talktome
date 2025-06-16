import * as flatbuffers from 'flatbuffers';
export declare class VideoOrientationChangeNotification implements flatbuffers.IUnpackableObject<VideoOrientationChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): VideoOrientationChangeNotification;
    static getRootAsVideoOrientationChangeNotification(bb: flatbuffers.ByteBuffer, obj?: VideoOrientationChangeNotification): VideoOrientationChangeNotification;
    static getSizePrefixedRootAsVideoOrientationChangeNotification(bb: flatbuffers.ByteBuffer, obj?: VideoOrientationChangeNotification): VideoOrientationChangeNotification;
    camera(): boolean;
    flip(): boolean;
    rotation(): number;
    static startVideoOrientationChangeNotification(builder: flatbuffers.Builder): void;
    static addCamera(builder: flatbuffers.Builder, camera: boolean): void;
    static addFlip(builder: flatbuffers.Builder, flip: boolean): void;
    static addRotation(builder: flatbuffers.Builder, rotation: number): void;
    static endVideoOrientationChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createVideoOrientationChangeNotification(builder: flatbuffers.Builder, camera: boolean, flip: boolean, rotation: number): flatbuffers.Offset;
    unpack(): VideoOrientationChangeNotificationT;
    unpackTo(_o: VideoOrientationChangeNotificationT): void;
}
export declare class VideoOrientationChangeNotificationT implements flatbuffers.IGeneratedObject {
    camera: boolean;
    flip: boolean;
    rotation: number;
    constructor(camera?: boolean, flip?: boolean, rotation?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=video-orientation-change-notification.d.ts.map