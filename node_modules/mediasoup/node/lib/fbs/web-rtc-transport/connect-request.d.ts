import * as flatbuffers from 'flatbuffers';
import { DtlsParameters, DtlsParametersT } from '../../fbs/web-rtc-transport/dtls-parameters';
export declare class ConnectRequest implements flatbuffers.IUnpackableObject<ConnectRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConnectRequest;
    static getRootAsConnectRequest(bb: flatbuffers.ByteBuffer, obj?: ConnectRequest): ConnectRequest;
    static getSizePrefixedRootAsConnectRequest(bb: flatbuffers.ByteBuffer, obj?: ConnectRequest): ConnectRequest;
    dtlsParameters(obj?: DtlsParameters): DtlsParameters | null;
    static startConnectRequest(builder: flatbuffers.Builder): void;
    static addDtlsParameters(builder: flatbuffers.Builder, dtlsParametersOffset: flatbuffers.Offset): void;
    static endConnectRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createConnectRequest(builder: flatbuffers.Builder, dtlsParametersOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ConnectRequestT;
    unpackTo(_o: ConnectRequestT): void;
}
export declare class ConnectRequestT implements flatbuffers.IGeneratedObject {
    dtlsParameters: DtlsParametersT | null;
    constructor(dtlsParameters?: DtlsParametersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=connect-request.d.ts.map