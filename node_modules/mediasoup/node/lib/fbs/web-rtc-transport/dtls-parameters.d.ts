import * as flatbuffers from 'flatbuffers';
import { DtlsRole } from '../../fbs/web-rtc-transport/dtls-role';
import { Fingerprint, FingerprintT } from '../../fbs/web-rtc-transport/fingerprint';
export declare class DtlsParameters implements flatbuffers.IUnpackableObject<DtlsParametersT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DtlsParameters;
    static getRootAsDtlsParameters(bb: flatbuffers.ByteBuffer, obj?: DtlsParameters): DtlsParameters;
    static getSizePrefixedRootAsDtlsParameters(bb: flatbuffers.ByteBuffer, obj?: DtlsParameters): DtlsParameters;
    fingerprints(index: number, obj?: Fingerprint): Fingerprint | null;
    fingerprintsLength(): number;
    role(): DtlsRole;
    static startDtlsParameters(builder: flatbuffers.Builder): void;
    static addFingerprints(builder: flatbuffers.Builder, fingerprintsOffset: flatbuffers.Offset): void;
    static createFingerprintsVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startFingerprintsVector(builder: flatbuffers.Builder, numElems: number): void;
    static addRole(builder: flatbuffers.Builder, role: DtlsRole): void;
    static endDtlsParameters(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDtlsParameters(builder: flatbuffers.Builder, fingerprintsOffset: flatbuffers.Offset, role: DtlsRole): flatbuffers.Offset;
    unpack(): DtlsParametersT;
    unpackTo(_o: DtlsParametersT): void;
}
export declare class DtlsParametersT implements flatbuffers.IGeneratedObject {
    fingerprints: (FingerprintT)[];
    role: DtlsRole;
    constructor(fingerprints?: (FingerprintT)[], role?: DtlsRole);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dtls-parameters.d.ts.map