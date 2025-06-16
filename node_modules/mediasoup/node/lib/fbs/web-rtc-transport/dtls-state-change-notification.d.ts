import * as flatbuffers from 'flatbuffers';
import { DtlsState } from '../../fbs/web-rtc-transport/dtls-state';
export declare class DtlsStateChangeNotification implements flatbuffers.IUnpackableObject<DtlsStateChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DtlsStateChangeNotification;
    static getRootAsDtlsStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: DtlsStateChangeNotification): DtlsStateChangeNotification;
    static getSizePrefixedRootAsDtlsStateChangeNotification(bb: flatbuffers.ByteBuffer, obj?: DtlsStateChangeNotification): DtlsStateChangeNotification;
    dtlsState(): DtlsState;
    remoteCert(): string | null;
    remoteCert(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startDtlsStateChangeNotification(builder: flatbuffers.Builder): void;
    static addDtlsState(builder: flatbuffers.Builder, dtlsState: DtlsState): void;
    static addRemoteCert(builder: flatbuffers.Builder, remoteCertOffset: flatbuffers.Offset): void;
    static endDtlsStateChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDtlsStateChangeNotification(builder: flatbuffers.Builder, dtlsState: DtlsState, remoteCertOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): DtlsStateChangeNotificationT;
    unpackTo(_o: DtlsStateChangeNotificationT): void;
}
export declare class DtlsStateChangeNotificationT implements flatbuffers.IGeneratedObject {
    dtlsState: DtlsState;
    remoteCert: string | Uint8Array | null;
    constructor(dtlsState?: DtlsState, remoteCert?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dtls-state-change-notification.d.ts.map