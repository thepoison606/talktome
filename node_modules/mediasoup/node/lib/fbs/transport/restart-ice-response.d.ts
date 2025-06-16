import * as flatbuffers from 'flatbuffers';
export declare class RestartIceResponse implements flatbuffers.IUnpackableObject<RestartIceResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): RestartIceResponse;
    static getRootAsRestartIceResponse(bb: flatbuffers.ByteBuffer, obj?: RestartIceResponse): RestartIceResponse;
    static getSizePrefixedRootAsRestartIceResponse(bb: flatbuffers.ByteBuffer, obj?: RestartIceResponse): RestartIceResponse;
    usernameFragment(): string | null;
    usernameFragment(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    password(): string | null;
    password(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    iceLite(): boolean;
    static startRestartIceResponse(builder: flatbuffers.Builder): void;
    static addUsernameFragment(builder: flatbuffers.Builder, usernameFragmentOffset: flatbuffers.Offset): void;
    static addPassword(builder: flatbuffers.Builder, passwordOffset: flatbuffers.Offset): void;
    static addIceLite(builder: flatbuffers.Builder, iceLite: boolean): void;
    static endRestartIceResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createRestartIceResponse(builder: flatbuffers.Builder, usernameFragmentOffset: flatbuffers.Offset, passwordOffset: flatbuffers.Offset, iceLite: boolean): flatbuffers.Offset;
    unpack(): RestartIceResponseT;
    unpackTo(_o: RestartIceResponseT): void;
}
export declare class RestartIceResponseT implements flatbuffers.IGeneratedObject {
    usernameFragment: string | Uint8Array | null;
    password: string | Uint8Array | null;
    iceLite: boolean;
    constructor(usernameFragment?: string | Uint8Array | null, password?: string | Uint8Array | null, iceLite?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=restart-ice-response.d.ts.map