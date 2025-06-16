import * as flatbuffers from 'flatbuffers';
export declare class Score implements flatbuffers.IUnpackableObject<ScoreT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Score;
    static getRootAsScore(bb: flatbuffers.ByteBuffer, obj?: Score): Score;
    static getSizePrefixedRootAsScore(bb: flatbuffers.ByteBuffer, obj?: Score): Score;
    encodingIdx(): number;
    ssrc(): number;
    rid(): string | null;
    rid(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    score(): number;
    static startScore(builder: flatbuffers.Builder): void;
    static addEncodingIdx(builder: flatbuffers.Builder, encodingIdx: number): void;
    static addSsrc(builder: flatbuffers.Builder, ssrc: number): void;
    static addRid(builder: flatbuffers.Builder, ridOffset: flatbuffers.Offset): void;
    static addScore(builder: flatbuffers.Builder, score: number): void;
    static endScore(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createScore(builder: flatbuffers.Builder, encodingIdx: number, ssrc: number, ridOffset: flatbuffers.Offset, score: number): flatbuffers.Offset;
    unpack(): ScoreT;
    unpackTo(_o: ScoreT): void;
}
export declare class ScoreT implements flatbuffers.IGeneratedObject {
    encodingIdx: number;
    ssrc: number;
    rid: string | Uint8Array | null;
    score: number;
    constructor(encodingIdx?: number, ssrc?: number, rid?: string | Uint8Array | null, score?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=score.d.ts.map