import * as flatbuffers from 'flatbuffers';
import { Parameter, ParameterT } from '../../fbs/rtp-parameters/parameter';
import { RtpHeaderExtensionUri } from '../../fbs/rtp-parameters/rtp-header-extension-uri';
export declare class RtpHeaderExtensionParameters implements flatbuffers.IUnpackableObject<RtpHeaderExtensionParametersT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RtpHeaderExtensionParameters;
    static getRootAsRtpHeaderExtensionParameters(bb: flatbuffers.ByteBuffer, obj?: RtpHeaderExtensionParameters): RtpHeaderExtensionParameters;
    static getSizePrefixedRootAsRtpHeaderExtensionParameters(bb: flatbuffers.ByteBuffer, obj?: RtpHeaderExtensionParameters): RtpHeaderExtensionParameters;
    uri(): RtpHeaderExtensionUri;
    id(): number;
    encrypt(): boolean;
    parameters(index: number, obj?: Parameter): Parameter | null;
    parametersLength(): number;
    static startRtpHeaderExtensionParameters(builder: flatbuffers.Builder): void;
    static addUri(builder: flatbuffers.Builder, uri: RtpHeaderExtensionUri): void;
    static addId(builder: flatbuffers.Builder, id: number): void;
    static addEncrypt(builder: flatbuffers.Builder, encrypt: boolean): void;
    static addParameters(builder: flatbuffers.Builder, parametersOffset: flatbuffers.Offset): void;
    static createParametersVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startParametersVector(builder: flatbuffers.Builder, numElems: number): void;
    static endRtpHeaderExtensionParameters(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRtpHeaderExtensionParameters(builder: flatbuffers.Builder, uri: RtpHeaderExtensionUri, id: number, encrypt: boolean, parametersOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): RtpHeaderExtensionParametersT;
    unpackTo(_o: RtpHeaderExtensionParametersT): void;
}
export declare class RtpHeaderExtensionParametersT implements flatbuffers.IGeneratedObject {
    uri: RtpHeaderExtensionUri;
    id: number;
    encrypt: boolean;
    parameters: (ParameterT)[];
    constructor(uri?: RtpHeaderExtensionUri, id?: number, encrypt?: boolean, parameters?: (ParameterT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=rtp-header-extension-parameters.d.ts.map