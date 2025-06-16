import * as flatbuffers from 'flatbuffers';
import { FingerprintAlgorithm } from '../../fbs/web-rtc-transport/fingerprint-algorithm';
export declare class Fingerprint implements flatbuffers.IUnpackableObject<FingerprintT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Fingerprint;
    static getRootAsFingerprint(bb: flatbuffers.ByteBuffer, obj?: Fingerprint): Fingerprint;
    static getSizePrefixedRootAsFingerprint(bb: flatbuffers.ByteBuffer, obj?: Fingerprint): Fingerprint;
    algorithm(): FingerprintAlgorithm;
    value(): string | null;
    value(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startFingerprint(builder: flatbuffers.Builder): void;
    static addAlgorithm(builder: flatbuffers.Builder, algorithm: FingerprintAlgorithm): void;
    static addValue(builder: flatbuffers.Builder, valueOffset: flatbuffers.Offset): void;
    static endFingerprint(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createFingerprint(builder: flatbuffers.Builder, algorithm: FingerprintAlgorithm, valueOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): FingerprintT;
    unpackTo(_o: FingerprintT): void;
}
export declare class FingerprintT implements flatbuffers.IGeneratedObject {
    algorithm: FingerprintAlgorithm;
    value: string | Uint8Array | null;
    constructor(algorithm?: FingerprintAlgorithm, value?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=fingerprint.d.ts.map