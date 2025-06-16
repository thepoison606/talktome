import * as flatbuffers from 'flatbuffers';
import { SctpState } from '../../fbs/sctp-association/sctp-state';
export declare class SctpStateChangeNotification implements flatbuffers.IUnpackableObject<SctpStateChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SctpStateChangeNotification;
    static getRootAsSctpStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: SctpStateChangeNotification): SctpStateChangeNotification;
    static getSizePrefixedRootAsSctpStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: SctpStateChangeNotification): SctpStateChangeNotification;
    sctpState(): SctpState;
    static startSctpStateChangeNotification(builder: flatbuffers.Builder): void;
    static addSctpState(builder: flatbuffers.Builder, sctpState: SctpState): void;
    static endSctpStateChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSctpStateChangeNotification(builder: flatbuffers.Builder, sctpState: SctpState): flatbuffers.Offset;
    unpack(): SctpStateChangeNotificationT;
    unpackTo(_o: SctpStateChangeNotificationT): void;
}
export declare class SctpStateChangeNotificationT implements flatbuffers.IGeneratedObject {
    sctpState: SctpState;
    constructor(sctpState?: SctpState);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=sctp-state-change-notification.d.ts.map