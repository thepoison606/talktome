import * as flatbuffers from 'flatbuffers';
import { SrtpParameters, SrtpParametersT } from '../../fbs/srtp-parameters/srtp-parameters';
export declare class ConnectRequest implements flatbuffers.IUnpackableObject<ConnectRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConnectRequest;
    static getRootAsConnectRequest(bb: flatbuffers.ByteBuffer, obj?: ConnectRequest): ConnectRequest;
    static getSizePrefixedRootAsConnectRequest(bb: flatbuffers.ByteBuffer, obj?: ConnectRequest): ConnectRequest;
    ip(): string | null;
    ip(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    port(): number | null;
    srtpParameters(obj?: SrtpParameters): SrtpParameters | null;
    static startConnectRequest(builder: flatbuffers.Builder): void;
    static addIp(builder: flatbuffers.Builder, ipOffset: flatbuffers.Offset): void;
    static addPort(builder: flatbuffers.Builder, port: number): void;
    static addSrtpParameters(builder: flatbuffers.Builder, srtpParametersOffset: flatbuffers.Offset): void;
    static endConnectRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): ConnectRequestT;
    unpackTo(_o: ConnectRequestT): void;
}
export declare class ConnectRequestT implements flatbuffers.IGeneratedObject {
    ip: string | Uint8Array | null;
    port: number | null;
    srtpParameters: SrtpParametersT | null;
    constructor(ip?: string | Uint8Array | null, port?: number | null, srtpParameters?: SrtpParametersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=connect-request.d.ts.map