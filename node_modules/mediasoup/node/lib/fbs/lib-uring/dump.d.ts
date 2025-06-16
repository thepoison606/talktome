import * as flatbuffers from 'flatbuffers';
export declare class Dump implements flatbuffers.IUnpackableObject<DumpT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Dump;
    static getRootAsDump(bb: flatbuffers.ByteBuffer, obj?: Dump): Dump;
    static getSizePrefixedRootAsDump(bb: flatbuffers.ByteBuffer, obj?: Dump): Dump;
    sqeProcessCount(): bigint;
    sqeMissCount(): bigint;
    userDataMissCount(): bigint;
    static startDump(builder: flatbuffers.Builder): void;
    static addSqeProcessCount(builder: flatbuffers.Builder, sqeProcessCount: bigint): void;
    static addSqeMissCount(builder: flatbuffers.Builder, sqeMissCount: bigint): void;
    static addUserDataMissCount(builder: flatbuffers.Builder, userDataMissCount: bigint): void;
    static endDump(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createDump(builder: flatbuffers.Builder, sqeProcessCount: bigint, sqeMissCount: bigint, userDataMissCount: bigint): flatbuffers.Offset;
    unpack(): DumpT;
    unpackTo(_o: DumpT): void;
}
export declare class DumpT implements flatbuffers.IGeneratedObject {
    sqeProcessCount: bigint;
    sqeMissCount: bigint;
    userDataMissCount: bigint;
    constructor(sqeProcessCount?: bigint, sqeMissCount?: bigint, userDataMissCount?: bigint);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump.d.ts.map