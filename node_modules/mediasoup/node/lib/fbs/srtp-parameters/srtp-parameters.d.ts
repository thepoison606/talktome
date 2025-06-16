import * as flatbuffers from 'flatbuffers';
import { SrtpCryptoSuite } from '../../fbs/srtp-parameters/srtp-crypto-suite';
export declare class SrtpParameters implements flatbuffers.IUnpackableObject<SrtpParametersT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): SrtpParameters;
    static getRootAsSrtpParameters(bb: flatbuffers.ByteBuffer, obj?: SrtpParameters): SrtpParameters;
    static getSizePrefixedRootAsSrtpParameters(bb: flatbuffers.ByteBuffer, obj?: SrtpParameters): SrtpParameters;
    cryptoSuite(): SrtpCryptoSuite;
    keyBase64(): string | null;
    keyBase64(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startSrtpParameters(builder: flatbuffers.Builder): void;
    static addCryptoSuite(builder: flatbuffers.Builder, cryptoSuite: SrtpCryptoSuite): void;
    static addKeyBase64(builder: flatbuffers.Builder, keyBase64Offset: flatbuffers.Offset): void;
    static endSrtpParameters(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createSrtpParameters(builder: flatbuffers.Builder, cryptoSuite: SrtpCryptoSuite, keyBase64Offset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): SrtpParametersT;
    unpackTo(_o: SrtpParametersT): void;
}
export declare class SrtpParametersT implements flatbuffers.IGeneratedObject {
    cryptoSuite: SrtpCryptoSuite;
    keyBase64: string | Uint8Array | null;
    constructor(cryptoSuite?: SrtpCryptoSuite, keyBase64?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=srtp-parameters.d.ts.map