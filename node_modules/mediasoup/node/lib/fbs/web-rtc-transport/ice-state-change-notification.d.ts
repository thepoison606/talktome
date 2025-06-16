import * as flatbuffers from 'flatbuffers';
import { IceState } from '../../fbs/web-rtc-transport/ice-state';
export declare class IceStateChangeNotification implements flatbuffers.IUnpackableObject<IceStateChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): IceStateChangeNotification;
    static getRootAsIceStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: IceStateChangeNotification): IceStateChangeNotification;
    static getSizePrefixedRootAsIceStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: IceStateChangeNotification): IceStateChangeNotification;
    iceState(): IceState;
    static startIceStateChangeNotification(builder: flatbuffers.Builder): void;
    static addIceState(builder: flatbuffers.Builder, iceState: IceState): void;
    static endIceStateChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createIceStateChangeNotification(builder: flatbuffers.Builder, iceState: IceState): flatbuffers.Offset;
    unpack(): IceStateChangeNotificationT;
    unpackTo(_o: IceStateChangeNotificationT): void;
}
export declare class IceStateChangeNotificationT implements flatbuffers.IGeneratedObject {
    iceState: IceState;
    constructor(iceState?: IceState);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=ice-state-change-notification.d.ts.map