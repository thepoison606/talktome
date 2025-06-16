import * as flatbuffers from 'flatbuffers';
import { DtlsRole } from '../../fbs/web-rtc-transport/dtls-role';
export declare class ConnectResponse implements flatbuffers.IUnpackableObject<ConnectResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConnectResponse;
    static getRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    static getSizePrefixedRootAsConnectResponse(bb: flatbuffers.ByteBuffer, obj?: ConnectResponse): ConnectResponse;
    dtlsLocalRole(): DtlsRole;
    static startConnectResponse(builder: flatbuffers.Builder): void;
    static addDtlsLocalRole(builder: flatbuffers.Builder, dtlsLocalRole: DtlsRole): void;
    static endConnectResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createConnectResponse(builder: flatbuffers.Builder, dtlsLocalRole: DtlsRole): flatbuffers.Offset;
    unpack(): ConnectResponseT;
    unpackTo(_o: ConnectResponseT): void;
}
export declare class ConnectResponseT implements flatbuffers.IGeneratedObject {
    dtlsLocalRole: DtlsRole;
    constructor(dtlsLocalRole?: DtlsRole);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=connect-response.d.ts.map